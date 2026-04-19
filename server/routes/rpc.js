/**
 * RPC routes — replaces all supabase.rpc() calls made by the frontend.
 *
 * Endpoints:
 *   POST /rpc/post_sale
 *   POST /rpc/deduct_bank_balance
 *   POST /rpc/add_bank_balance
 *   POST /rpc/post_receiving
 *   POST /rpc/create_payable_from_receiving
 *   POST /rpc/delete_receiving
 *   POST /rpc/issue_stock_transfer
 *   POST /rpc/receive_stock_transfer
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  computeBaseQuantity,
  computeCostPerBase,
  loadProductUnitMeta,
  resolveSaleLineUnits,
} from '../lib/productUnits.js';
import { syncSupplierToInventoryMirror } from '../lib/supplierMirror.js';

const router = Router();

function roundCurrency(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function parseImportMoney(value, label) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative amount with at most 2 decimal places`);
  }
  return Number(normalized);
}

function parseImportDate(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label} must be in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return normalized;
}

function toSqlDateTime(value, label = 'datetime') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid datetime`);
  }
  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function parseProductMoney(value, label) {
  const amount = roundCurrency(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a valid non-negative amount`);
  }
  return amount;
}

function parseProductQuantity(value, label) {
  const qty = Number(value ?? 0);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error(`${label} must be a valid non-negative quantity`);
  }
  return qty;
}

// ── Helper: next sequence value (replaces PostgreSQL sequences) ──
async function nextSeq(conn, name) {
  await conn.query(
    'INSERT IGNORE INTO pos_sequences (seq_name, seq_value) VALUES (?, 0)',
    [name]
  );
  await conn.query(
    'UPDATE pos_sequences SET seq_value = seq_value + 1 WHERE seq_name = ?',
    [name]
  );
  const [rows] = await conn.query(
    'SELECT seq_value FROM pos_sequences WHERE seq_name = ?',
    [name]
  );
  return rows[0]?.seq_value ?? 1;
}

async function getTableColumnSet(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

function pickColumns(row, availableColumns) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => availableColumns.has(column))
  );
}

async function insertCompatibleRow(conn, tableName, row, availableColumns = null) {
  const columnSet = availableColumns instanceof Set ? availableColumns : await getTableColumnSet(conn, tableName);
  const payload = pickColumns(row, columnSet);
  const columns = Object.keys(payload);

  if (!columns.length) {
    throw new Error(`No compatible columns found for ${tableName}`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((column) => payload[column]);
  const sql = `INSERT INTO \`${tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${placeholders})`;
  await conn.query(sql, values);
  return payload;
}

async function updateCompatibleRows(conn, tableName, whereClause, whereParams, row, availableColumns = null) {
  const columnSet = availableColumns instanceof Set ? availableColumns : await getTableColumnSet(conn, tableName);
  const payload = pickColumns(row, columnSet);
  const columns = Object.keys(payload);

  if (!columns.length) {
    return;
  }

  const assignments = columns.map((column) => `\`${column}\` = ?`).join(', ');
  const values = columns.map((column) => payload[column]);
  await conn.query(`UPDATE \`${tableName}\` SET ${assignments} WHERE ${whereClause}`, [...values, ...whereParams]);
}

async function getInventoryBalanceSnapshot(conn, productId, locationId) {
  const balanceColumns = await getTableColumnSet(conn, 'inventory_balances');
  const selectableColumns = ['id', 'qty_on_hand'];
  if (balanceColumns.has('qty_available')) {
    selectableColumns.push('qty_available');
  }

  const [balanceRows] = await conn.query(
    `SELECT ${selectableColumns.map((column) => `\`${column}\``).join(', ')}
       FROM inventory_balances
      WHERE product_id = ? AND location_id = ?
      LIMIT 1`,
    [productId, locationId]
  );

  const balance = balanceRows[0] ?? null;
  const qtyBefore = Number(balance?.qty_on_hand ?? 0);
  const qtyAvailableBefore = Number(balance?.qty_available ?? qtyBefore);

  return { balanceColumns, balance, qtyBefore, qtyAvailableBefore };
}

function parsePurchaseOrderQuantity(value, label) {
  const qty = Number(value ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return qty;
}

function parseOptionalImportQuantity(value, label) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return null;

  const qty = Number(normalized);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error(`${label} must be a valid non-negative quantity`);
  }

  return Number(qty.toFixed(3));
}

async function applyImportedInventoryBalance(conn, {
  productId,
  locationId,
  targetQty,
  actorId = null,
  adjustmentDate = new Date().toISOString().slice(0, 10),
  remarks = '',
}) {
  const normalizedDate = parseImportDate(adjustmentDate, 'Adjustment date');
  const now = toSqlDateTime(new Date().toISOString());

  const [productRows] = await conn.query(
    `SELECT id, name, sku_code, COALESCE(default_cost, cost_price, 0) AS unit_cost
       FROM inv_products
      WHERE id = ?
      LIMIT 1`,
    [productId]
  );

  const product = productRows[0];
  if (!product) {
    throw new Error('Product not found while applying imported quantity');
  }

  const { balanceColumns, balance, qtyBefore, qtyAvailableBefore } = await getInventoryBalanceSnapshot(
    conn,
    productId,
    locationId,
  );
  const qtyAfter = Number(targetQty.toFixed(3));
  const qtyChange = Number((qtyAfter - qtyBefore).toFixed(3));

  if (Math.abs(qtyChange) < 0.0005) {
    return;
  }

  const direction = qtyChange > 0 ? 'add' : 'deduct';
  const movementType = direction === 'add' ? 'adjustment_add' : 'adjustment_deduct';
  const adjustmentId = uuidv4();
  const adjustmentNumber = await nextAdjustmentNumber(conn, normalizedDate);
  const movementId = uuidv4();
  const itemId = uuidv4();
  const changeLabel = `${qtyChange > 0 ? '+' : ''}${qtyChange}`;
  const normalizedRemarks = remarks || `CSV import stock update for ${product.name}`;
  const itemNotes = `Before: ${qtyBefore} | Change: ${changeLabel} | After: ${qtyAfter}${normalizedRemarks ? ` | ${normalizedRemarks}` : ''}`;

  const adjustmentsColumns = await getTableColumnSet(conn, 'adjustments');
  await insertCompatibleRow(conn, 'adjustments', {
    id: adjustmentId,
    adjustment_number: adjustmentNumber,
    adj_number: adjustmentNumber,
    location_id: locationId,
    adjustment_date: normalizedDate,
    adj_date: normalizedDate,
    reason: 'system_correction',
    direction,
    adj_type: direction === 'add' ? 'addition' : 'deduction',
    remarks: normalizedRemarks,
    status: 'posted',
    approved_by: actorId,
    approved_at: now,
    posted_by: actorId,
    posted_at: now,
    created_by: actorId,
    updated_by: actorId,
    created_at: now,
    updated_at: now,
  }, adjustmentsColumns);

  const movementColumns = await getTableColumnSet(conn, 'inventory_movements');
  await insertCompatibleRow(conn, 'inventory_movements', {
    id: movementId,
    product_id: productId,
    location_id: locationId,
    movement_type: movementType,
    qty_change: qtyChange,
    qty_before: qtyBefore,
    qty_after: qtyAfter,
    unit_cost: Number(product.unit_cost ?? 0),
    ref_number: adjustmentNumber,
    notes: itemNotes,
    created_by: actorId,
    created_at: now,
    updated_at: now,
  }, movementColumns);

  const adjustmentItemColumns = await getTableColumnSet(conn, 'adjustment_items');
  await insertCompatibleRow(conn, 'adjustment_items', {
    id: itemId,
    adjustment_id: adjustmentId,
    product_id: productId,
    qty: Math.abs(qtyChange),
    unit_cost: Number(product.unit_cost ?? 0),
    notes: itemNotes,
    sort_order: 1,
    movement_id: movementId,
    qty_before: qtyBefore,
    qty_adjusted: qtyChange,
    qty_after: qtyAfter,
    reason: itemNotes,
    created_at: now,
    updated_at: now,
  }, adjustmentItemColumns);

  if (balance) {
    await updateCompatibleRows(conn, 'inventory_balances', 'product_id = ? AND location_id = ?', [productId, locationId], {
      qty_on_hand: qtyAfter,
      qty_available: qtyAvailableBefore + qtyChange,
      last_movement_at: now,
      updated_at: now,
    }, balanceColumns);
  } else {
    await insertCompatibleRow(conn, 'inventory_balances', {
      id: uuidv4(),
      product_id: productId,
      location_id: locationId,
      qty_on_hand: qtyAfter,
      qty_available: qtyAfter,
      last_movement_at: now,
      created_at: now,
      updated_at: now,
    }, balanceColumns);
  }
}

async function getPurchaseOrderReceivingStatus(conn, poId) {
  const [poItems] = await conn.query(
    'SELECT qty_ordered, qty_received FROM purchase_order_items WHERE po_id = ?',
    [poId]
  );

  if (!poItems.length) {
    return 'approved';
  }

  const anyReceived = poItems.some(
    (item) => parseFloat(item.qty_received ?? 0) > 0
  );
  if (!anyReceived) {
    return 'approved';
  }

  const fullyReceived = poItems.every(
    (item) => parseFloat(item.qty_received ?? 0) >= parseFloat(item.qty_ordered ?? 0)
  );
  return fullyReceived ? 'fully_received' : 'partially_received';
}

async function nextPurchaseOrderNumber(conn, orderDate) {
  const sequence = await nextSeq(conn, 'purchase_order');
  const normalizedDate = parseImportDate(orderDate, 'Order date');
  const dateToken = normalizedDate.replace(/-/g, '');
  return `PO-${dateToken}-${String(sequence).padStart(4, '0')}`;
}

async function nextReceivingNumber(conn, receivingDate) {
  const sequence = await nextSeq(conn, 'receiving');
  const normalizedDate = parseImportDate(receivingDate, 'Receiving date');
  const dateToken = normalizedDate.replace(/-/g, '');
  return `RCV-${dateToken}-${String(sequence).padStart(4, '0')}`;
}

async function nextPayableNumber(conn) {
  const [seqRows] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING(payable_number, 5) AS UNSIGNED)) AS mx
       FROM payables
      WHERE payable_number LIKE 'PAY-%'`
  );
  const nextNumber = Number(seqRows[0]?.mx ?? 0) + 1;
  return `PAY-${String(nextNumber).padStart(6, '0')}`;
}

async function nextAdjustmentNumber(conn, adjustmentDate) {
  const sequence = await nextSeq(conn, 'inventory_adjustment');
  const normalizedDate = parseImportDate(adjustmentDate, 'Adjustment date');
  const dateToken = normalizedDate.replace(/-/g, '');
  return `ADJ-${dateToken}-${String(sequence).padStart(4, '0')}`;
}

router.post('/save_inventory_product', requireAuth, async (req, res) => {
  const { product_id = null, product = {} } = req.body?.payload ?? req.body;
  const skuCode = String(product.sku_code ?? '').trim();
  const name = String(product.name ?? '').trim();
  const unitId = String(product.unit_id ?? '').trim();

  if (!skuCode || !name) {
    return res.status(400).json({ error: 'SKU and product name are required' });
  }
  if (!unitId) {
    return res.status(400).json({ error: 'Unit is required' });
  }

  let retailPrice;
  let wholesalePrice;
  let specialPrice;
  let defaultCost;
  let wholesaleQuantity;
  let reorderPoint;

  try {
    defaultCost = parseProductMoney(product.default_cost, 'Cost');
    retailPrice = parseProductMoney(product.retail_price, 'Retail price');
    wholesalePrice = parseProductMoney(product.wholesale_price, 'Wholesale price');
    specialPrice = parseProductMoney(product.special_price, 'Special price');
    wholesaleQuantity = parseProductQuantity(product.wholesale_quantity, 'Wholesale quantity');
    reorderPoint = parseProductQuantity(product.reorder_point, 'Reorder level');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (retailPrice <= defaultCost) {
    return res.status(400).json({ error: 'Retail price must be greater than cost' });
  }
  if ((wholesalePrice > 0 && wholesaleQuantity <= 0) || (wholesaleQuantity > 0 && wholesalePrice <= 0)) {
    return res.status(400).json({ error: 'Wholesale price and wholesale quantity must both be set' });
  }

  const actorId = req.user?.id ?? null;
  const now = toSqlDateTime(new Date().toISOString());
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let changedByName = '';
    if (actorId) {
      const [profileRows] = await conn.query(
        'SELECT name, email FROM profiles WHERE id = ? LIMIT 1',
        [actorId]
      );
      changedByName = String(profileRows[0]?.name ?? profileRows[0]?.email ?? '').trim();
    }

    let existing = null;
    let productId = product_id ? String(product_id) : '';
    if (productId) {
      const [existingRows] = await conn.query(
        `SELECT id, default_cost, cost_price, retail_price, wholesale_price, special_price
           FROM inv_products
          WHERE id = ?
          LIMIT 1`,
        [productId]
      );
      existing = existingRows[0] ?? null;
      if (!existing) {
        await conn.rollback();
        return res.status(404).json({ error: 'Product not found' });
      }
    } else {
      productId = uuidv4();
    }

    const payload = [
      skuCode,
      String(product.barcode ?? '').trim(),
      String(product.barcode2 ?? '').trim(),
      name,
      String(product.description ?? '').trim(),
      product.category_id || null,
      product.brand_id || null,
      unitId,
      unitId,
      unitId,
      product.supplier_id || null,
      defaultCost,
      defaultCost,
      retailPrice,
      wholesalePrice,
      specialPrice,
      retailPrice,
      reorderPoint,
      product.is_expiry_tracked ? 1 : 0,
      product.is_active ? 1 : 0,
      now,
    ];

    if (existing) {
      await conn.query(
        `UPDATE inv_products
            SET sku_code = ?, barcode = ?, barcode2 = ?, name = ?, description = ?,
                category_id = ?, brand_id = ?, unit_id = ?, base_unit_id = ?, default_purchase_unit_id = ?,
                supplier_id = ?, cost_price = ?, default_cost = ?, retail_price = ?, wholesale_price = ?,
                special_price = ?, selling_price = ?, reorder_point = ?, is_expiry_tracked = ?, is_active = ?,
                updated_at = ?
          WHERE id = ?`,
        [...payload, productId]
      );
    } else {
      await conn.query(
        `INSERT INTO inv_products (
           id, sku_code, barcode, barcode2, name, description,
           category_id, brand_id, unit_id, base_unit_id, default_purchase_unit_id, supplier_id,
           cost_price, default_cost, retail_price, wholesale_price, special_price, selling_price,
           reorder_point, is_expiry_tracked, is_active, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, ...payload.slice(0, 20), actorId, now, now]
      );
    }

    await conn.query('DELETE FROM inv_product_unit_conversions WHERE product_id = ?', [productId]);
    await conn.query('DELETE FROM inv_product_selling_units WHERE product_id = ?', [productId]);

    await conn.query(
      `INSERT INTO inv_product_unit_conversions (
         id, product_id, unit_id, equivalent_qty_in_base_unit, allow_purchase, allow_sale, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), productId, unitId, 1, 1, 1, 0]
    );

    const sellingUnitId = uuidv4();
    const wholesaleEnabled = wholesalePrice > 0 && wholesaleQuantity > 0;
    await conn.query(
      `INSERT INTO inv_product_selling_units (
         id, product_id, unit_id, qty_in_base_unit, selling_price, retail_price, wholesale_price, special_price,
         wholesale_enabled, wholesale_break_qty_in_base_unit, wholesale_block_price, is_default, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sellingUnitId,
        productId,
        unitId,
        1,
        retailPrice,
        retailPrice,
        wholesalePrice,
        specialPrice,
        wholesaleEnabled ? 1 : 0,
        wholesaleEnabled ? wholesaleQuantity : 0,
        wholesaleEnabled ? wholesalePrice : 0,
        1,
        0,
      ]
    );

    await conn.query(
      'UPDATE inv_products SET default_selling_unit_id = ?, updated_at = ? WHERE id = ?',
      [sellingUnitId, now, productId]
    );

    const previousCost = existing ? roundCurrency(existing.default_cost ?? existing.cost_price ?? 0) : null;
    const previousRetail = existing ? roundCurrency(existing.retail_price ?? 0) : null;
    const previousWholesale = existing ? roundCurrency(existing.wholesale_price ?? 0) : null;
    const previousSpecial = existing ? roundCurrency(existing.special_price ?? 0) : null;
    const pricingChanged =
      existing == null
      || previousCost !== defaultCost
      || previousRetail !== retailPrice
      || previousWholesale !== wholesalePrice
      || previousSpecial !== specialPrice;

    if (pricingChanged) {
      await conn.query(
        `INSERT INTO inv_product_pricing_history (
           id, product_id, old_cost, new_cost, old_retail_price, new_retail_price,
           old_wholesale_price, new_wholesale_price, old_special_price, new_special_price,
           changed_by, changed_by_name, changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          productId,
          previousCost,
          defaultCost,
          previousRetail,
          retailPrice,
          previousWholesale,
          wholesalePrice,
          previousSpecial,
          specialPrice,
          actorId,
          changedByName,
          now,
        ]
      );
    }

    await conn.commit();
    res.json({ product_id: productId });
  } catch (error) {
    await conn.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'SKU or barcode already exists' });
    }
    console.error('save_inventory_product error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

router.post('/save_purchase_order', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const purchaseOrderId = String(payload.po_id ?? payload.id ?? '').trim();
  const supplierId = String(payload.supplier_id ?? '').trim();
  const locationId = String(payload.location_id ?? '').trim();
  const orderDate = String(payload.order_date ?? '').trim();
  const expectedDateRaw = String(payload.expected_date ?? '').trim();
  const notes = String(payload.notes ?? '').trim();
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  if (!supplierId) {
    return res.status(400).json({ error: 'Supplier is required' });
  }
  if (!locationId) {
    return res.status(400).json({ error: 'Location is required' });
  }

  try {
    parseImportDate(orderDate, 'Order date');
    if (expectedDateRaw) {
      parseImportDate(expectedDateRaw, 'Expected date');
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let items;
  try {
    items = rawItems.map((item, index) => {
      const productId = String(item.product_id ?? '').trim();
      if (!productId) {
        throw new Error(`Item ${index + 1}: product is required`);
      }

      const qtyOrdered = parsePurchaseOrderQuantity(item.qty_ordered, `Item ${index + 1} quantity`);
      const unitCost = parseProductMoney(item.unit_cost, `Item ${index + 1} unit cost`);
      const qtyInBase = Number(item.qty_in_base_unit_per_purchase ?? 1);
      const normalizedQtyInBase = Number.isFinite(qtyInBase) && qtyInBase > 0 ? qtyInBase : 1;

      return {
        product_id: productId,
        purchase_unit_id: item.purchase_unit_id ? String(item.purchase_unit_id).trim() : null,
        purchase_unit_name: String(item.purchase_unit_name ?? '').trim(),
        qty_in_base_unit_per_purchase: normalizedQtyInBase,
        qty_ordered: qtyOrdered,
        qty_ordered_in_base_unit: qtyOrdered * normalizedQtyInBase,
        unit_cost: unitCost,
        subtotal: roundCurrency(qtyOrdered * unitCost),
        cost_per_base_unit: computeCostPerBase(unitCost, normalizedQtyInBase),
        notes: String(item.notes ?? '').trim(),
        sort_order: index,
      };
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (items.length === 0) {
    return res.status(400).json({ error: 'At least one valid purchase order item is required' });
  }

  const conn = await pool.getConnection();
  const now = toSqlDateTime(new Date().toISOString());

  try {
    await conn.beginTransaction();

    const totalAmount = roundCurrency(items.reduce((sum, item) => sum + item.subtotal, 0));
    const purchaseOrderColumns = await getTableColumnSet(conn, 'purchase_orders');
    const purchaseOrderItemColumns = await getTableColumnSet(conn, 'purchase_order_items');
    let poId = purchaseOrderId;
    let poNumber = '';

    if (poId) {
      const [rows] = await conn.query(
        'SELECT id, po_number, status FROM purchase_orders WHERE id = ? LIMIT 1',
        [poId]
      );
      const existing = rows[0];
      if (!existing) {
        await conn.rollback();
        return res.status(404).json({ error: 'Purchase order not found' });
      }
      if (existing.status !== 'draft') {
        await conn.rollback();
        return res.status(400).json({ error: 'Only draft purchase orders can be edited' });
      }

      poNumber = String(existing.po_number ?? '');
      const updatePayload = pickColumns({
        supplier_id: supplierId,
        location_id: locationId,
        order_date: orderDate,
        expected_date: expectedDateRaw || null,
        notes,
        total_amount: totalAmount,
        updated_at: now,
      }, purchaseOrderColumns);
      const updateCols = Object.keys(updatePayload);
      await conn.query(
        `UPDATE purchase_orders
            SET ${updateCols.map((column) => `\`${column}\` = ?`).join(', ')}
          WHERE id = ?`,
        [...updateCols.map((column) => updatePayload[column]), poId]
      );
      await conn.query('DELETE FROM purchase_order_items WHERE po_id = ?', [poId]);
    } else {
      poId = uuidv4();
      poNumber = await nextPurchaseOrderNumber(conn, orderDate);
      const insertPayload = pickColumns({
        id: poId,
        po_number: poNumber,
        supplier_id: supplierId,
        location_id: locationId,
        status: 'draft',
        order_date: orderDate,
        expected_date: expectedDateRaw || null,
        notes,
        total_amount: totalAmount,
        created_by: req.user?.id ?? null,
        created_at: now,
        updated_at: now,
      }, purchaseOrderColumns);
      const insertCols = Object.keys(insertPayload);
      await conn.query(
        `INSERT INTO purchase_orders (${insertCols.map((column) => `\`${column}\``).join(', ')})
         VALUES (${insertCols.map(() => '?').join(', ')})`,
        insertCols.map((column) => insertPayload[column])
      );
    }

    for (const item of items) {
      const itemPayload = pickColumns({
        id: uuidv4(),
        po_id: poId,
        product_id: item.product_id,
        purchase_unit_id: item.purchase_unit_id,
        purchase_unit_name: item.purchase_unit_name,
        qty_in_base_unit_per_purchase: item.qty_in_base_unit_per_purchase,
        qty_ordered: item.qty_ordered,
        qty_ordered_in_base_unit: item.qty_ordered_in_base_unit,
        qty_received: 0,
        qty_received_in_base_unit: 0,
        unit_cost: item.unit_cost,
        subtotal: item.subtotal,
        cost_per_base_unit: item.cost_per_base_unit,
        notes: item.notes,
        sort_order: item.sort_order,
        created_at: now,
        updated_at: now,
      }, purchaseOrderItemColumns);
      const itemCols = Object.keys(itemPayload);
      await conn.query(
        `INSERT INTO purchase_order_items (${itemCols.map((column) => `\`${column}\``).join(', ')})
         VALUES (${itemCols.map(() => '?').join(', ')})`,
        itemCols.map((column) => itemPayload[column])
      );
    }

    await conn.commit();
    res.json({ id: poId, po_number: poNumber, total_amount: totalAmount });
  } catch (error) {
    await conn.rollback();
    console.error('save_purchase_order error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

router.post('/receive_purchase_order', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const poId = String(payload.po_id ?? '').trim();
  const receivingDate = String(payload.receiving_date ?? '').trim();
  const invoiceNumber = String(payload.invoice_number ?? '').trim();
  const drNumber = String(payload.dr_number ?? '').trim();
  const remarks = String(payload.remarks ?? '').trim();
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  if (!poId) {
    return res.status(400).json({ error: 'Purchase order is required' });
  }

  try {
    parseImportDate(receivingDate, 'Receiving date');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [poRows] = await conn.query(
      'SELECT * FROM purchase_orders WHERE id = ? LIMIT 1',
      [poId]
    );
    const purchaseOrder = poRows[0];
    if (!purchaseOrder) {
      await conn.rollback();
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    if (!['approved', 'partially_received'].includes(String(purchaseOrder.status ?? ''))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Only approved purchase orders can be received' });
    }

    const [poItemRows] = await conn.query(
      'SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY sort_order ASC, id ASC',
      [poId]
    );
    const poItemMap = new Map(poItemRows.map((item) => [String(item.id), item]));

    const normalizedItems = rawItems.map((item, index) => {
      const poItemId = String(item.po_item_id ?? '').trim();
      const poItem = poItemMap.get(poItemId);
      if (!poItem) {
        throw new Error(`Item ${index + 1}: purchase order line not found`);
      }

      const qtyAccepted = Number(item.qty_accepted ?? 0);
      const qtyRejected = Number(item.qty_rejected ?? 0);
      if (!Number.isFinite(qtyAccepted) || qtyAccepted < 0) {
        throw new Error(`Item ${index + 1}: accepted quantity must be 0 or greater`);
      }
      if (!Number.isFinite(qtyRejected) || qtyRejected < 0) {
        throw new Error(`Item ${index + 1}: rejected quantity must be 0 or greater`);
      }
      if (qtyAccepted <= 0 && qtyRejected <= 0) {
        return null;
      }

      const qtyOrdered = Number(poItem.qty_ordered ?? 0);
      const qtyPrevReceived = Number(poItem.qty_received ?? 0);
      const qtyRemaining = Math.max(qtyOrdered - qtyPrevReceived, 0);
      if (qtyAccepted > qtyRemaining) {
        throw new Error(`Item ${index + 1}: accepted quantity exceeds remaining PO quantity`);
      }

      const qtyInBaseUnitPerPurchase = Number(item.qty_in_base_unit_per_purchase ?? poItem.qty_in_base_unit_per_purchase ?? 1) || 1;
      const unitCost = parseProductMoney(item.unit_cost ?? poItem.unit_cost ?? 0, `Item ${index + 1} unit cost`);
      const acceptedBaseQty = computeBaseQuantity(qtyAccepted, qtyInBaseUnitPerPurchase);
      const rejectedBaseQty = computeBaseQuantity(qtyRejected, qtyInBaseUnitPerPurchase);

      return {
        po_item_id: poItemId,
        product_id: String(poItem.product_id ?? item.product_id ?? '').trim(),
        purchase_unit_id: item.purchase_unit_id ? String(item.purchase_unit_id).trim() : (poItem.purchase_unit_id ?? null),
        purchase_unit_name: String(item.purchase_unit_name ?? poItem.purchase_unit_name ?? '').trim(),
        qty_in_base_unit_per_purchase: qtyInBaseUnitPerPurchase,
        qty_ordered: qtyOrdered,
        qty_prev_received: qtyPrevReceived,
        qty_remaining: qtyRemaining,
        qty_received: qtyAccepted + qtyRejected,
        qty_accepted: qtyAccepted,
        qty_rejected: qtyRejected,
        qty_received_in_base_unit: acceptedBaseQty + rejectedBaseQty,
        qty_accepted_in_base_unit: acceptedBaseQty,
        qty_rejected_in_base_unit: rejectedBaseQty,
        unit_cost: unitCost,
        unit_cost_per_base: computeCostPerBase(unitCost, qtyInBaseUnitPerPurchase),
        expiry_date: String(item.expiry_date ?? '').trim() || null,
        batch_number: String(item.batch_number ?? '').trim(),
        notes: String(item.notes ?? '').trim(),
        sort_order: index,
      };
    }).filter(Boolean);

    if (normalizedItems.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Enter accepted or rejected quantity for at least one item' });
    }

    const receivingColumns = await getTableColumnSet(conn, 'receivings');
    const receivingItemColumns = await getTableColumnSet(conn, 'receiving_items');
    const poItemColumns = await getTableColumnSet(conn, 'purchase_order_items');
    const purchaseOrderColumns = await getTableColumnSet(conn, 'purchase_orders');
    const payableColumns = await getTableColumnSet(conn, 'payables');
    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');
    const now = toSqlDateTime(new Date().toISOString());
    const receivingId = uuidv4();
    const receivingNumber = await nextReceivingNumber(conn, receivingDate);

    const receivingPayload = pickColumns({
      id: receivingId,
      receiving_number: receivingNumber,
      po_id: poId,
      supplier_id: purchaseOrder.supplier_id,
      location_id: purchaseOrder.location_id,
      status: 'draft',
      receiving_date: receivingDate,
      invoice_number: invoiceNumber,
      dr_number: drNumber,
      remarks,
      created_by: req.user?.id ?? null,
      created_at: now,
      updated_at: now,
    }, receivingColumns);
    const receivingCols = Object.keys(receivingPayload);
    await conn.query(
      `INSERT INTO receivings (${receivingCols.map((column) => `\`${column}\``).join(', ')})
       VALUES (${receivingCols.map(() => '?').join(', ')})`,
      receivingCols.map((column) => receivingPayload[column])
    );

    for (const item of normalizedItems) {
      const itemPayload = pickColumns({
        id: uuidv4(),
        receiving_id: receivingId,
        po_item_id: item.po_item_id,
        product_id: item.product_id,
        purchase_unit_id: item.purchase_unit_id,
        purchase_unit_name: item.purchase_unit_name,
        qty_in_base_unit_per_purchase: item.qty_in_base_unit_per_purchase,
        qty_ordered: item.qty_ordered,
        qty_prev_received: item.qty_prev_received,
        qty_remaining: item.qty_remaining,
        qty_received: item.qty_received,
        qty_accepted: item.qty_accepted,
        qty_rejected: item.qty_rejected,
        qty_received_in_base_unit: item.qty_received_in_base_unit,
        qty_accepted_in_base_unit: item.qty_accepted_in_base_unit,
        qty_rejected_in_base_unit: item.qty_rejected_in_base_unit,
        unit_cost: item.unit_cost,
        unit_cost_per_base: item.unit_cost_per_base,
        expiry_date: item.expiry_date,
        batch_number: item.batch_number,
        notes: item.notes,
        sort_order: item.sort_order,
        created_at: now,
        updated_at: now,
      }, receivingItemColumns);
      const itemCols = Object.keys(itemPayload);
      await conn.query(
        `INSERT INTO receiving_items (${itemCols.map((column) => `\`${column}\``).join(', ')})
         VALUES (${itemCols.map(() => '?').join(', ')})`,
        itemCols.map((column) => itemPayload[column])
      );

      if (item.qty_accepted_in_base_unit <= 0) continue;

      const [balRows] = await conn.query(
        'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
        [item.product_id, purchaseOrder.location_id]
      );
      const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
      const qtyAfter = qtyBefore + item.qty_accepted_in_base_unit;

      await insertCompatibleRow(conn, 'inventory_movements', {
        id: uuidv4(),
        product_id: item.product_id,
        location_id: purchaseOrder.location_id,
        movement_type: 'receiving',
        qty_change: item.qty_accepted_in_base_unit,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        unit_cost: item.unit_cost_per_base,
        ref_number: receivingNumber,
        notes: `Receiving ${receivingNumber}`,
        created_by: req.user.id,
        display_unit_id: item.purchase_unit_id,
        display_unit_name: item.purchase_unit_name,
        display_qty: item.qty_accepted,
        qty_in_base_unit_per_display: item.qty_in_base_unit_per_purchase,
        base_unit_name: item.purchase_unit_name || '',
      }, movementColumns);

      await conn.query(
        `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
        [uuidv4(), item.product_id, purchaseOrder.location_id, qtyAfter, item.qty_accepted_in_base_unit]
      );

      const poItemUpdate = pickColumns({
        qty_received: Number(poItemMap.get(item.po_item_id)?.qty_received ?? 0) + item.qty_accepted,
        qty_received_in_base_unit: Number(poItemMap.get(item.po_item_id)?.qty_received_in_base_unit ?? 0) + item.qty_accepted_in_base_unit,
        updated_at: now,
      }, poItemColumns);
      const poItemUpdateCols = Object.keys(poItemUpdate);
      if (poItemUpdateCols.length > 0) {
        await conn.query(
          `UPDATE purchase_order_items
              SET ${poItemUpdateCols.map((column) => `\`${column}\` = ?`).join(', ')}
            WHERE id = ?`,
          [...poItemUpdateCols.map((column) => poItemUpdate[column]), item.po_item_id]
        );
      }
    }

    const nextPoStatus = await getPurchaseOrderReceivingStatus(conn, poId);
    const poStatusUpdate = pickColumns({
      status: nextPoStatus,
      updated_at: now,
    }, purchaseOrderColumns);
    const poStatusCols = Object.keys(poStatusUpdate);
    if (poStatusCols.length > 0) {
      await conn.query(
        `UPDATE purchase_orders
            SET ${poStatusCols.map((column) => `\`${column}\` = ?`).join(', ')}
          WHERE id = ?`,
        [...poStatusCols.map((column) => poStatusUpdate[column]), poId]
      );
    }

    const receivingStatusUpdate = pickColumns({
      status: 'posted',
      posted_by: req.user?.id ?? null,
      posted_at: now,
      updated_at: now,
    }, receivingColumns);
    const receivingStatusCols = Object.keys(receivingStatusUpdate);
    if (receivingStatusCols.length > 0) {
      await conn.query(
        `UPDATE receivings
            SET ${receivingStatusCols.map((column) => `\`${column}\` = ?`).join(', ')}
          WHERE id = ?`,
        [...receivingStatusCols.map((column) => receivingStatusUpdate[column]), receivingId]
      );
    }

    const amount = roundCurrency(
      normalizedItems.reduce((sum, item) => sum + (item.qty_accepted * item.unit_cost), 0)
    );
    if (amount > 0) {
      const [existingPayableRows] = await conn.query(
        'SELECT id FROM payables WHERE receiving_id = ? LIMIT 1',
        [receivingId]
      );
      if (!existingPayableRows[0]) {
        const payablePayload = pickColumns({
          id: uuidv4(),
          payable_number: await nextPayableNumber(conn),
          supplier_id: purchaseOrder.supplier_id,
          receiving_id: receivingId,
          invoice_number: invoiceNumber,
          amount,
          balance: amount,
          status: 'open',
          notes: remarks,
          created_by: req.user?.id ?? null,
          created_at: now,
          updated_at: now,
        }, payableColumns);
        const payableCols = Object.keys(payablePayload);
        await conn.query(
          `INSERT INTO payables (${payableCols.map((column) => `\`${column}\``).join(', ')})
           VALUES (${payableCols.map(() => '?').join(', ')})`,
          payableCols.map((column) => payablePayload[column])
        );
      }
    }

    await conn.commit();
    res.json({ receiving_id: receivingId, receiving_number: receivingNumber });
  } catch (error) {
    await conn.rollback();
    console.error('receive_purchase_order error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

async function restoreInventory(conn, {
  productId,
  locationId,
  qty,
  refNumber,
  refId = null,
  notes,
  createdBy = null,
  movementType = 'sale_return',
  displayUnitId = null,
  displayUnitName = '',
  displayQty = null,
  qtyInBaseUnitPerDisplay = 1,
  baseUnitName = '',
  unitCost = null,
}) {
  if (!productId || !qty) return;

  const [balRows] = await conn.query(
    'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
    [productId, locationId]
  );
  const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
  const qtyAfter = qtyBefore + qty;

  await conn.query(
    `INSERT INTO inventory_movements
       (id, product_id, location_id, movement_type, qty_change, qty_before,
        qty_after, unit_cost, ref_number, ref_id, notes, created_by,
        display_unit_id, display_unit_name, display_qty, qty_in_base_unit_per_display, base_unit_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      productId,
      locationId,
      movementType,
      qty,
      qtyBefore,
      qtyAfter,
      unitCost,
      refNumber,
      refId,
      notes,
      createdBy,
      displayUnitId,
      displayUnitName,
      displayQty ?? qty,
      qtyInBaseUnitPerDisplay,
      baseUnitName,
    ]
  );

  await conn.query(
    `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
    [uuidv4(), productId, locationId, qtyAfter, qty]
  );
}

async function getShiftForPosting(conn, shiftId) {
  const [shiftRows] = await conn.query(
    `SELECT shift_id, terminal_id, cashier_id, location_id, status,
            COALESCE(business_date, shift_date) AS business_date,
            opened_at, closed_at, closed_by,
            z_reading_posted_at, z_reading_posted_by,
            z_reading_reset_at, z_reading_reset_by, z_reading_reset_reason
       FROM pos_shifts
      WHERE shift_id = ?
      LIMIT 1`,
    [shiftId]
  );
  return shiftRows[0] ?? null;
}

async function postCustomerCreditLedgerEntry(conn, {
  customerId,
  entryType,
  amount,
  paymentMethod = 'cash',
  referenceNo = '',
  paymentNumber = '',
  saleId = null,
  notes = '',
  createdBy = null,
  targetAccountType = '',
  targetAccountId = null,
  targetAccountName = '',
  accountingEntryId = null,
}) {
  const normalizedAmount = roundCurrency(amount);
  if (!customerId || normalizedAmount <= 0) {
    return { id: null, balanceBefore: 0, balanceAfter: 0, createdAt: null };
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const ledgerEntryId = uuidv4();
  const customerColumns = await getTableColumnSet(conn, 'pos_customers');
  const ledgerColumns = await getTableColumnSet(conn, 'customer_credit_ledger');

  const [customerRows] = await conn.query(
    'SELECT customer_id, COALESCE(credit_balance, 0) AS credit_balance FROM pos_customers WHERE customer_id = ? LIMIT 1',
    [customerId]
  );

  if (!customerRows[0]) {
    throw new Error('Selected customer was not found.');
  }

  const balanceBefore = roundCurrency(customerRows[0].credit_balance);
  const delta = entryType === 'payment' ? -normalizedAmount : normalizedAmount;
  const balanceAfter = roundCurrency(balanceBefore + delta);

  if (balanceAfter < -0.005) {
    throw new Error('Customer payment exceeds the outstanding credit balance.');
  }

  await insertCompatibleRow(conn, 'customer_credit_ledger', {
    id: ledgerEntryId,
    customer_id: customerId,
    entry_type: entryType,
    amount: normalizedAmount,
    balance_before: balanceBefore,
    balance_after: Math.max(0, balanceAfter),
    payment_method: normalizeSalePaymentMethod(paymentMethod) || 'cash',
    reference_number: String(referenceNo ?? '').trim(),
    payment_number: String(paymentNumber ?? '').trim(),
    sale_id: saleId,
    notes: String(notes ?? '').trim(),
    created_by: createdBy,
    target_account_type: String(targetAccountType ?? '').trim(),
    target_account_id: targetAccountId,
    target_account_name: String(targetAccountName ?? '').trim(),
    accounting_entry_id: accountingEntryId,
    created_at: now,
    updated_at: now,
  }, ledgerColumns);

  await updateCompatibleRows(conn, 'pos_customers', 'customer_id = ?', [customerId], {
    credit_balance: Math.max(0, balanceAfter),
    updated_at: now,
  }, customerColumns);

  return {
    id: ledgerEntryId,
    balanceBefore,
    balanceAfter: Math.max(0, balanceAfter),
    createdAt: now,
  };
}

async function recordCustomerCreditPaymentAccounting(conn, {
  ledgerEntryId,
  customerId,
  customerName,
  amount,
  paymentMethod,
  paymentNumber,
  referenceNo,
  notes,
  createdBy,
  accountId = null,
}) {
  const normalizedAmount = roundCurrency(amount);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const txDate = now.slice(0, 10);
  const cleanReference = String(paymentNumber || referenceNo || '').trim();
  const cleanNotes = String(notes ?? '').trim();
  const description = `Customer credit payment - ${String(customerName || customerId).trim()}`;

  if (paymentMethod === 'cash') {
    const entryId = uuidv4();
    const cashTxColumns = await getTableColumnSet(conn, 'cash_transactions');
    await insertCompatibleRow(conn, 'cash_transactions', {
      id: entryId,
      transaction_type: 'cash_in',
      transaction_category: 'regular',
      amount: normalizedAmount,
      date: txDate,
      description,
      notes: cleanNotes,
      reference_number: cleanReference,
      source_module: 'customer_credit_payment',
      source_reference_id: ledgerEntryId,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    }, cashTxColumns);

    return {
      accountingEntryId: entryId,
      targetAccountType: 'cash_fund',
      targetAccountId: null,
      targetAccountName: 'Cash Fund',
    };
  }

  if (paymentMethod === 'gcash') {
    if (!accountId) {
      throw new Error('Select which GCash account will receive the payment.');
    }

    const [accountRows] = await conn.query(
      'SELECT id, name FROM accounts WHERE id = ? LIMIT 1',
      [accountId]
    );
    const account = accountRows[0] ?? null;
    if (!account) {
      throw new Error('Selected GCash account was not found.');
    }

    const entryId = uuidv4();
    const gcashTxColumns = await getTableColumnSet(conn, 'transactions');
    await insertCompatibleRow(conn, 'transactions', {
      id: entryId,
      account_id: account.id,
      transaction_type: 'cash_in',
      transaction_category: 'regular',
      cash_in_mode: 'payment',
      amount: normalizedAmount,
      transaction_fee: 0,
      amount_received: normalizedAmount,
      fee_type: 'gcash',
      delivery_fee: 0,
      cash_balance: 0,
      date: txDate,
      description,
      reference_number: cleanReference,
      source: 'gcash',
      notes: cleanNotes,
      source_module: 'customer_credit_payment',
      source_reference_id: ledgerEntryId,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    }, gcashTxColumns);

    await conn.query(
      `UPDATE accounts
          SET current_running_balance = COALESCE(current_running_balance, 0) + ?,
              updated_at = NOW()
        WHERE id = ?`,
      [normalizedAmount, account.id]
    );

    return {
      accountingEntryId: entryId,
      targetAccountType: 'gcash',
      targetAccountId: String(account.id),
      targetAccountName: String(account.name ?? 'GCash'),
    };
  }

  throw new Error('Unsupported payment method for customer credit payment.');
}

function normalizeSalePaymentMethod(value) {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  if (method === 'charge' || method === 'credit' || method === 'account') return 'charge';
  return '';
}

async function getBusinessDatePosSummary(conn, businessDate, terminalId) {
  const [saleRows] = await conn.query(
    `SELECT s.sale_id, COALESCE(s.total_amount, 0) AS total_amount
       FROM sales s
       JOIN pos_shifts ps ON ps.shift_id = s.shift_id
      WHERE COALESCE(ps.business_date, ps.shift_date) = ?
        AND ps.terminal_id = ?
        AND s.sale_status = 'completed'`,
    [businessDate, terminalId]
  );

  const sales = saleRows.map(row => ({
    saleId: String(row.sale_id ?? ''),
    totalAmount: roundCurrency(row.total_amount),
  })).filter(row => row.saleId);

  if (sales.length === 0) {
    return {
      totalPosSales: 0,
      cashPosSales: 0,
      gcashPosSales: 0,
      cardPosSales: 0,
      includedCostOfSales: 0,
    };
  }

  const saleIds = sales.map(row => row.saleId);
  const [[paymentRows], [costRows]] = await Promise.all([
    conn.query(
      `SELECT sp.sale_id, sp.payment_method, COALESCE(SUM(sp.amount), 0) AS total
         FROM sale_payments sp
        WHERE sp.sale_id IN (?)
        GROUP BY sp.sale_id, sp.payment_method`,
      [saleIds]
    ),
    conn.query(
      `SELECT si.sale_id,
              COALESCE(SUM(COALESCE(si.total_base_qty_deducted, si.qty, 0) * COALESCE(si.cost_per_base_unit, si.cost_at_sale, 0)), 0) AS sale_cost
         FROM sale_items si
        WHERE si.sale_id IN (?)
        GROUP BY si.sale_id`,
      [saleIds]
    ),
  ]);

  const paymentsBySaleId = new Map();
  for (const payment of paymentRows) {
    const saleId = String(payment.sale_id ?? '');
    const method = normalizeSalePaymentMethod(payment.payment_method);
    if (!saleId || !method) continue;
    const bucket = paymentsBySaleId.get(saleId) ?? {};
    bucket[method] = roundCurrency((bucket[method] ?? 0) + Number(payment.total ?? 0));
    paymentsBySaleId.set(saleId, bucket);
  }

  const costBySaleId = new Map(
    costRows.map(row => [String(row.sale_id ?? ''), roundCurrency(row.sale_cost)])
  );

  let totalPosSales = 0;
  let cashPosSales = 0;
  let gcashPosSales = 0;
  let includedCostOfSales = 0;

  for (const sale of sales) {
    totalPosSales = roundCurrency(totalPosSales + sale.totalAmount);

    const paymentTotals = paymentsBySaleId.get(sale.saleId) ?? {};
    const gcashAmount = roundCurrency(paymentTotals.gcash ?? 0);
    const rawCashAmount = roundCurrency(paymentTotals.cash ?? 0);
    const remainingForCash = Math.max(0, roundCurrency(sale.totalAmount - gcashAmount));
    const appliedCashAmount = Math.min(rawCashAmount, remainingForCash);
    const includedSalesAmount = roundCurrency(appliedCashAmount + gcashAmount);

    cashPosSales = roundCurrency(cashPosSales + appliedCashAmount);
    gcashPosSales = roundCurrency(gcashPosSales + gcashAmount);

    const saleCost = roundCurrency(costBySaleId.get(sale.saleId) ?? 0);
    const costShareRatio = sale.totalAmount > 0 ? Math.min(1, includedSalesAmount / sale.totalAmount) : 0;
    includedCostOfSales = roundCurrency(includedCostOfSales + (saleCost * costShareRatio));
  }

  return {
    totalPosSales,
    cashPosSales,
    gcashPosSales,
    cardPosSales: 0,
    includedCostOfSales,
  };
}

async function upsertDailySalesFromPos(conn, {
  businessDate,
  userId,
  summary,
}) {
  const syncedSales = roundCurrency(summary.cashPosSales + summary.gcashPosSales);
  const syncNote = `POS Z Reading auto-post for ${businessDate}`;

  await conn.query(
    `INSERT INTO daily_sales
       (id, date, sales, cost_of_sales, description, total_pos_sales,
        cash_pos_sales, gcash_pos_sales, card_pos_sales, pos_synced_at, notes, created_by, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       sales = VALUES(sales),
       cost_of_sales = VALUES(cost_of_sales),
       description = CASE
         WHEN TRIM(COALESCE(description, '')) = '' THEN VALUES(description)
         ELSE description
       END,
       total_pos_sales = VALUES(total_pos_sales),
       cash_pos_sales = VALUES(cash_pos_sales),
       gcash_pos_sales = VALUES(gcash_pos_sales),
       card_pos_sales = VALUES(card_pos_sales),
       pos_synced_at = NOW(),
       notes = CASE
         WHEN TRIM(COALESCE(notes, '')) = '' THEN VALUES(notes)
         ELSE notes
       END,
       is_deleted = 0,
       updated_at = NOW()`,
    [
      businessDate,
      syncedSales,
      roundCurrency(summary.includedCostOfSales),
      'POS Z Reading sync',
      roundCurrency(summary.totalPosSales),
      roundCurrency(summary.cashPosSales),
      roundCurrency(summary.gcashPosSales),
      roundCurrency(summary.cardPosSales),
      syncNote,
      userId,
    ]
  );

  return {
    sales: syncedSales,
    cost_of_sales: roundCurrency(summary.includedCostOfSales),
    total_pos_sales: roundCurrency(summary.totalPosSales),
    cash_pos_sales: roundCurrency(summary.cashPosSales),
    gcash_pos_sales: roundCurrency(summary.gcashPosSales),
    card_pos_sales: roundCurrency(summary.cardPosSales),
  };
}

async function appendDailySalesResetNote(conn, {
  businessDate,
  terminalId,
  shiftId,
  reason,
  resetAt,
}) {
  const resetNote = `Z Reading reset ${resetAt} | terminal ${terminalId} | shift ${shiftId} | reason: ${reason}`;
  await conn.query(
    `UPDATE daily_sales
        SET notes = TRIM(CONCAT(COALESCE(notes, ''), CASE WHEN TRIM(COALESCE(notes, '')) = '' THEN '' ELSE '\n' END, ?)),
            updated_at = NOW()
      WHERE date = ?`,
    [resetNote, businessDate]
  );
}

router.post('/open_pos_shift', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const shiftDate = parseImportDate(payload.shift_date ?? payload.business_date, 'business date');
  const openingCash = parseImportMoney(payload.opening_cash ?? 0, 'opening cash');
  const terminalId = String(payload.terminal_id ?? '').trim();
  const notes = String(payload.notes ?? '').trim();
  const conn = await pool.getConnection();

  if (!terminalId) {
    return res.status(400).json({ error: 'terminal_id is required' });
  }

  try {
    await conn.beginTransaction();

    const [[terminalRow], [lockedRows], [myOpenRows], [terminalOpenRows]] = await Promise.all([
      conn.query(
        'SELECT terminal_id, location_id FROM pos_terminals WHERE terminal_id = ? LIMIT 1',
        [terminalId]
      ),
      conn.query(
        `SELECT shift_id
           FROM pos_shifts
          WHERE terminal_id = ?
            AND COALESCE(business_date, shift_date) = ?
            AND z_reading_posted_at IS NOT NULL
          LIMIT 1`,
        [terminalId, shiftDate]
      ),
      conn.query(
        `SELECT shift_id
           FROM pos_shifts
          WHERE terminal_id = ?
            AND cashier_id = ?
            AND status = 'open'
          LIMIT 1`,
        [terminalId, req.user.id]
      ),
      conn.query(
        `SELECT shift_id
           FROM pos_shifts
          WHERE terminal_id = ?
            AND status = 'open'
          LIMIT 1`,
        [terminalId]
      ),
    ]);

    if (!terminalRow[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Terminal not found' });
    }

    if (lockedRows[0]) {
      await conn.rollback();
      return res.status(400).json({ error: 'Z Reading already posted for this register/day. Reset it from Settings before reopening.' });
    }

    if (myOpenRows[0]) {
      await conn.rollback();
      return res.status(400).json({ error: 'You already have an open shift on this terminal.' });
    }

    if (terminalOpenRows[0]) {
      await conn.rollback();
      return res.status(400).json({ error: 'This terminal already has an open shift.' });
    }

    const shiftId = uuidv4();
    await conn.query(
      `INSERT INTO pos_shifts
         (shift_id, terminal_id, cashier_id, location_id, shift_date, business_date, status, opening_cash, notes, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, NOW())`,
      [shiftId, terminalId, req.user.id, terminalRow[0].location_id, shiftDate, shiftDate, openingCash, notes]
    );

    await conn.commit();
    res.json({ shift_id: shiftId });
  } catch (err) {
    await conn.rollback();
    console.error('open_pos_shift error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/close_pos_shift', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const shiftId = String(payload.p_shift_id ?? payload.shift_id ?? '').trim();
  const actualCashCount = parseImportMoney(payload.p_actual_cash_count ?? payload.actual_cash_count ?? 0, 'actual cash count');
  const expectedCashCount = parseImportMoney(payload.p_expected_cash_count ?? payload.expected_cash_count ?? 0, 'expected cash count');
  const conn = await pool.getConnection();

  if (!shiftId) {
    return res.status(400).json({ error: 'shift_id is required' });
  }

  try {
    await conn.beginTransaction();

    const shift = await getShiftForPosting(conn, shiftId);
    if (!shift) {
      await conn.rollback();
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.cashier_id !== req.user.id && req.user.role !== 'admin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Only the assigned cashier or an admin can close this shift.' });
    }
    if (shift.z_reading_posted_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'Z Reading already posted. This shift is already day-closed.' });
    }
    if (shift.status !== 'open') {
      await conn.rollback();
      return res.status(400).json({ error: 'Shift is already closed.' });
    }

    const overShort = roundCurrency(actualCashCount - expectedCashCount);

    await conn.query(
      `UPDATE pos_shifts
          SET status = 'closed',
              expected_cash = ?,
              actual_cash = ?,
              over_short = ?,
              closed_at = NOW(),
              closed_by = ?
        WHERE shift_id = ?`,
      [expectedCashCount, actualCashCount, overShort, req.user.id, shiftId]
    );

    await conn.commit();
    res.json({
      shift_id: shiftId,
      business_date: shift.business_date,
      terminal_id: shift.terminal_id,
      expected_cash_count: expectedCashCount,
      actual_cash_count: actualCashCount,
      cash_over_short: overShort,
      status: 'closed',
    });
  } catch (err) {
    await conn.rollback();
    console.error('close_pos_shift error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/post_sale ──────────────────────────────────────────
//
// Atomically processes a POS checkout:
//   1. Validates shift is open
//   2. Checks stock availability per item
//   3. Inserts sale, sale_items, sale_payments
//   4. Posts inventory_movements (deductions)
//   5. Updates inventory_balances via trigger-equivalent logic
//
router.post('/post_sale', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const conn    = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const {
      shift_id, terminal_id, location_id, cashier_id,
      subtotal, discount_amount, total_amount,
      amount_tendered, change_amount,
      payment_method, reference_no,
      customer_id = null,
      items = [],
      payments = [],
    } = payload;

    // 1. Verify shift is open
    const [shiftRows] = await conn.query(
      'SELECT status, z_reading_posted_at FROM pos_shifts WHERE shift_id = ?',
      [shift_id]
    );
    if (!shiftRows[0] || shiftRows[0].status !== 'open' || shiftRows[0].z_reading_posted_at) {
      await conn.rollback();
      return res.json({ error: 'Z Reading already posted. Transactions are locked for this register/day.' });
    }

    const [systemStateRows] = await conn.query(
      'SELECT value FROM system_state WHERE setting_key = ? LIMIT 1',
      ['pos_allow_negative_qty']
    );
    const allowNegativeQty = ['1', 'true', 'yes', 'on'].includes(
      String(systemStateRows[0]?.value ?? '').trim().toLowerCase()
    );
    const productMeta = await loadProductUnitMeta(
      conn,
      items.map(item => item.product_id).filter(Boolean)
    );
    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');

    // 2. Check stock for each product line
    if (!allowNegativeQty) {
      for (const item of items) {
        if (!item.product_id) continue;
        const resolvedLine = resolveSaleLineUnits(productMeta.get(item.product_id), item);
        const [balRows] = await conn.query(
          'SELECT COALESCE(qty_on_hand, 0) AS qty FROM inventory_balances WHERE product_id = ? AND location_id = ?',
          [item.product_id, location_id]
        );
        const onHand = parseFloat(balRows[0]?.qty ?? 0);
        if (onHand < resolvedLine.totalBaseQty) {
          await conn.rollback();
          return res.json({
            error: `Insufficient stock for: ${item.product_name_snapshot}`,
            product_id: item.product_id,
          });
        }
      }
    }

    // 3. Generate receipt number
    const receiptSeq = await nextSeq(conn, 'receipt');
    const receiptNo  = `OS-${String(receiptSeq).padStart(8, '0')}`;
    const saleId     = uuidv4();

    await conn.query(
      `INSERT INTO sales
         (sale_id, shift_id, terminal_id, location_id, cashier_id,
          receipt_no, sale_status, subtotal, discount_amount, tax_amount,
          total_amount, amount_tendered, change_amount, customer_id, void_reason)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        saleId, shift_id, terminal_id, location_id, cashier_id,
        receiptNo,
        parseFloat(subtotal || 0),
        parseFloat(discount_amount || 0),
        parseFloat(total_amount || 0),
        parseFloat(amount_tendered || 0),
        parseFloat(change_amount || 0),
        customer_id || null,
        '',
      ]
    );

    // 4. Insert sale_items + inventory movements
    for (const item of items) {
      const itemId = uuidv4();
      const productUnitMeta = item.product_id ? productMeta.get(item.product_id) : null;
      const resolvedLine = resolveSaleLineUnits(productUnitMeta, item);

      await conn.query(
        `INSERT INTO sale_items
           (item_id, sale_id, product_id, selected_unit_id, selected_unit_name, base_unit_name,
             barcode, sku_code, product_name_snapshot, qty, qty_in_base_unit_per_unit, total_base_qty_deducted,
             retail_unit_price, unit_price, wholesale_enabled, wholesale_break_qty_in_base_unit,
             wholesale_block_price, wholesale_blocks_applied, wholesale_base_qty_applied,
             retail_remainder_base_qty, pricing_breakdown, selected_price_level, applied_price_level, price_source,
             discount_amount, subtotal, sort_order, cost_per_base_unit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          saleId,
          item.product_id || null,
          resolvedLine.selectedUnitId,
          resolvedLine.selectedUnitName,
          resolvedLine.baseUnitName,
          item.barcode || '',
          item.sku_code || '',
          item.product_name_snapshot || '',
          resolvedLine.qty,
          resolvedLine.qtyInBaseUnitPerUnit,
          resolvedLine.totalBaseQty,
          resolvedLine.retailUnitPrice,
          resolvedLine.unitPrice,
          resolvedLine.wholesaleEnabled ? 1 : 0,
          resolvedLine.wholesaleBreakQtyInBaseUnit,
          resolvedLine.wholesaleBlockPrice,
          resolvedLine.wholesaleBlocksApplied,
          resolvedLine.wholesaleBaseQtyApplied,
          resolvedLine.retailRemainderBaseQty,
          resolvedLine.pricingBreakdown,
          resolvedLine.selectedPriceLevel,
          resolvedLine.appliedPriceLevel,
          resolvedLine.priceSource,
          parseFloat(item.discount_amount || 0),
          parseFloat(item.subtotal),
          parseInt(item.sort_order || 0),
          resolvedLine.costPerBaseUnit,
        ]
      );

      if (item.product_id) {
        const movId = uuidv4();
        const qty = resolvedLine.totalBaseQty;

        const [balRows] = await conn.query(
          'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
          [item.product_id, location_id]
        );
        const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
        const qtyAfter = qtyBefore - qty;

        await insertCompatibleRow(conn, 'inventory_movements', {
          id: movId,
          product_id: item.product_id,
          location_id,
          movement_type: 'sale',
          qty_change: -qty,
          qty_before: qtyBefore,
          qty_after: qtyAfter,
          unit_cost: resolvedLine.costPerBaseUnit,
          ref_number: receiptNo,
          notes: `POS sale ${receiptNo}`,
          created_by: cashier_id,
          display_unit_id: resolvedLine.selectedUnitId,
          display_unit_name: resolvedLine.selectedUnitName,
          display_qty: resolvedLine.qty,
          qty_in_base_unit_per_display: resolvedLine.qtyInBaseUnitPerUnit,
          base_unit_name: resolvedLine.baseUnitName,
        }, movementColumns);

        await conn.query(
          `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand - ?`,
          [uuidv4(), item.product_id, location_id, qtyAfter, qty]
        );
      }
    }

    // 5. Insert payment rows and post any customer credit charges
    const paymentEntriesInput = Array.isArray(payments) && payments.length > 0
      ? payments
      : [{ method: payment_method, amount: amount_tendered, referenceNo: reference_no }];

    const normalizedPaymentEntries = [];
    let remainingAmount = roundCurrency(total_amount);

    for (const entry of paymentEntriesInput) {
      const normalizedMethod = normalizeSalePaymentMethod(entry?.method ?? entry?.payment_method);
      const rawAmount = roundCurrency(entry?.amount ?? 0);

      if (!normalizedMethod || rawAmount <= 0 || remainingAmount <= 0) {
        continue;
      }

      const appliedAmount = Math.min(rawAmount, remainingAmount);
      if (appliedAmount <= 0) {
        continue;
      }

      normalizedPaymentEntries.push({
        method: normalizedMethod,
        amount: appliedAmount,
        referenceNo: String(entry?.referenceNo ?? entry?.reference_no ?? reference_no ?? '').trim(),
      });
      remainingAmount = roundCurrency(remainingAmount - appliedAmount);
    }

    if (!normalizedPaymentEntries.length || remainingAmount > 0.005) {
      await conn.rollback();
      return res.json({ error: 'Payment method must fully cover the sale total.' });
    }

    if (normalizedPaymentEntries.some(entry => entry.method === 'charge') && !customer_id) {
      await conn.rollback();
      return res.json({ error: 'Select a customer before using Charge to Account.' });
    }

    for (const entry of normalizedPaymentEntries) {
      await conn.query(
        `INSERT INTO sale_payments (payment_id, sale_id, payment_method, amount, reference_no)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), saleId, entry.method, entry.amount, entry.referenceNo]
      );
    }

    const totalChargedToAccount = roundCurrency(
      normalizedPaymentEntries
        .filter(entry => entry.method === 'charge')
        .reduce((sum, entry) => sum + entry.amount, 0)
    );

    if (totalChargedToAccount > 0 && customer_id) {
      await postCustomerCreditLedgerEntry(conn, {
        customerId: customer_id,
        entryType: 'charge',
        amount: totalChargedToAccount,
        paymentMethod: 'charge',
        referenceNo: receiptNo,
        saleId,
        notes: String(reference_no ?? '').trim() || `POS charge sale ${receiptNo}`,
        createdBy: cashier_id,
      });
    }

    await conn.commit();
    res.json({ sale_id: saleId, receipt_no: receiptNo });
  } catch (err) {
    await conn.rollback();
    console.error('post_sale error:', err.message);
    res.json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/post_customer_credit_payment', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const customerId = String(payload.p_customer_id ?? payload.customer_id ?? '').trim();
    const amount = roundCurrency(payload.p_amount ?? payload.amount ?? 0);
    const paymentMethod = normalizeSalePaymentMethod(payload.p_payment_method ?? payload.payment_method ?? 'cash');
    const accountId = String(payload.p_account_id ?? payload.account_id ?? '').trim() || null;
    const referenceNo = String(payload.p_reference_no ?? payload.reference_no ?? '').trim();
    const notes = String(payload.p_notes ?? payload.notes ?? '').trim();
    const receivedBy = payload.p_received_by ?? payload.received_by ?? req.user?.id ?? null;

    if (!customerId) {
      await conn.rollback();
      return res.status(400).json({ error: 'Customer is required.' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    }
    if (!paymentMethod || paymentMethod === 'charge') {
      await conn.rollback();
      return res.status(400).json({ error: 'Payment method must be Cash or GCash.' });
    }

    const [customerRows] = await conn.query(
      'SELECT customer_id, first_name, last_name FROM pos_customers WHERE customer_id = ? LIMIT 1',
      [customerId]
    );
    const customer = customerRows[0] ?? null;
    if (!customer) {
      await conn.rollback();
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const paymentSeq = await nextSeq(conn, 'customer_credit_payment');
    const paymentNumber = `CCP-${String(paymentSeq).padStart(8, '0')}`;
    const customerName = `${String(customer.first_name ?? '').trim()} ${String(customer.last_name ?? '').trim()}`.trim() || 'Customer';

    const result = await postCustomerCreditLedgerEntry(conn, {
      customerId,
      entryType: 'payment',
      amount,
      paymentMethod,
      referenceNo,
      paymentNumber,
      notes,
      createdBy: receivedBy,
    });

    const accounting = await recordCustomerCreditPaymentAccounting(conn, {
      ledgerEntryId: result.id,
      customerId,
      customerName,
      amount,
      paymentMethod,
      paymentNumber,
      referenceNo,
      notes,
      createdBy: receivedBy,
      accountId,
    });

    await updateCompatibleRows(conn, 'customer_credit_ledger', 'id = ?', [result.id], {
      payment_number: paymentNumber,
      target_account_type: accounting.targetAccountType,
      target_account_id: accounting.targetAccountId,
      target_account_name: accounting.targetAccountName,
      accounting_entry_id: accounting.accountingEntryId,
    });

    await conn.commit();
    res.json({
      customer_id: customerId,
      customer_name: customerName,
      ledger_entry_id: result.id,
      payment_number: paymentNumber,
      amount,
      payment_method: paymentMethod,
      posted_to_type: accounting.targetAccountType,
      posted_to_label: accounting.targetAccountName,
      posted_to_account_id: accounting.targetAccountId,
      accounting_entry_id: accounting.accountingEntryId,
      balance_before: result.balanceBefore,
      balance_after: result.balanceAfter,
      created_at: result.createdAt,
      reference_no: referenceNo,
      notes,
    });
  } catch (err) {
    await conn.rollback();
    console.error('post_customer_credit_payment error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/post_z_reading', requireAuth, async (req, res) => {
  const { p_shift_id } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const shift = await getShiftForPosting(conn, p_shift_id);
    if (!shift) {
      await conn.rollback();
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.cashier_id !== req.user.id && req.user.role !== 'admin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Only the assigned cashier or an admin can post Z Reading.' });
    }
    if (shift.z_reading_posted_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'Z Reading already posted for this shift.' });
    }
    if (shift.status !== 'open' && shift.status !== 'closed') {
      await conn.rollback();
      return res.status(400).json({ error: 'Shift is not in a postable state.' });
    }

    const summary = await getBusinessDatePosSummary(conn, shift.business_date, shift.terminal_id);
    const dailySales = await upsertDailySalesFromPos(conn, {
      businessDate: shift.business_date,
      userId: req.user.id,
      summary,
    });

    await conn.query(
      `UPDATE pos_shifts
          SET status = 'closed',
              closed_at = COALESCE(closed_at, NOW()),
              closed_by = COALESCE(closed_by, ?),
              z_reading_posted_at = NOW(),
              z_reading_posted_by = ?,
              z_reading_reset_at = NULL,
              z_reading_reset_by = NULL,
              z_reading_reset_reason = NULL
        WHERE terminal_id = ?
          AND COALESCE(business_date, shift_date) = ?`,
      [req.user.id, req.user.id, shift.terminal_id, shift.business_date]
    );

    await conn.commit();
    res.json({
      shift_id: shift.shift_id,
      business_date: shift.business_date,
      ...dailySales,
    });
  } catch (err) {
    await conn.rollback();
    console.error('post_z_reading error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/void_sale', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const { sale_id, reason, actor_id } = payload;
    if (!String(reason ?? '').trim()) {
      await conn.rollback();
      return res.json({ error: 'Void reason is required' });
    }
    const [saleRows] = await conn.query(
      'SELECT sale_id, receipt_no, location_id, sale_status FROM sales WHERE sale_id = ? LIMIT 1',
      [sale_id]
    );
    const sale = saleRows[0];

    if (!sale) {
      await conn.rollback();
      return res.json({ error: 'Sale not found' });
    }
    if (sale.sale_status === 'voided') {
      await conn.rollback();
      return res.json({ error: 'Sale is already voided' });
    }

    const [itemRows] = await conn.query(
      `SELECT
         item_id, product_id, product_name_snapshot, qty,
         selected_unit_id, selected_unit_name, qty_in_base_unit_per_unit,
         total_base_qty_deducted, base_unit_name, cost_per_base_unit
       FROM sale_items
       WHERE sale_id = ?
       ORDER BY sort_order ASC`,
      [sale_id]
    );

    const [gcashRows] = await conn.query(
      `SELECT id, account_id, amount, amount_received, delivery_fee, reference_number, notes
         FROM transactions
        WHERE is_deleted = 0
          AND cash_in_mode = 'payment'
          AND (
            source_sale_id = ?
            OR reference_number = ?
            OR notes LIKE ?
            OR notes LIKE ?
          )`,
      [sale_id, sale.receipt_no, `%POS Ref: ${sale.receipt_no}%`, `%POS Sale - ${sale.receipt_no}%`]
    );

    for (const gcashTxn of gcashRows) {
      const [existingReversalRows] = await conn.query(
        `SELECT id
           FROM transactions
          WHERE is_deleted = 0
            AND reversal_of_transaction_id = ?
          LIMIT 1`,
        [gcashTxn.id]
      );
      if (existingReversalRows[0]) {
        await conn.rollback();
        return res.json({ error: 'GCash product-payment reversal already exists for this sale' });
      }
    }

    await conn.query(
      `UPDATE sales
       SET sale_status = 'voided',
           void_reason = ?,
           voided_by = ?,
           voided_at = NOW()
       WHERE sale_id = ?`,
      [reason || '', actor_id || null, sale_id]
    );

    for (const item of itemRows) {
      const qty = parseFloat(item.total_base_qty_deducted ?? item.qty ?? 0);
      await restoreInventory(conn, {
        productId: item.product_id,
        locationId: sale.location_id,
        qty,
        refNumber: sale.receipt_no,
        refId: sale_id,
        notes: `Void transaction ${sale.receipt_no} - ${item.product_name_snapshot || ''}`.trim(),
        createdBy: actor_id || null,
        movementType: 'sale_void',
        displayUnitId: item.selected_unit_id ?? null,
        displayUnitName: item.selected_unit_name ?? '',
        displayQty: parseFloat(item.qty ?? 0),
        qtyInBaseUnitPerDisplay: parseFloat(item.qty_in_base_unit_per_unit ?? 1),
        baseUnitName: item.base_unit_name ?? '',
        unitCost: item.cost_per_base_unit != null ? parseFloat(item.cost_per_base_unit) : null,
      });
    }

    for (const gcashTxn of gcashRows) {
      await conn.query(
        `INSERT INTO transactions
           (id, account_id, transaction_type, cash_in_mode, amount, transaction_fee, amount_received,
            fee_type, delivery_fee, cash_balance, date, description, reference_number, source, notes,
            cash_source, cash_out_type, bank_account_id, source_sale_id, reversal_of_transaction_id,
            is_deleted, is_closed, source_pos_remittance_id, created_by)
         VALUES (?, ?, 'cash_out', NULL, ?, 0, ?, 'gcash', ?, 0, CURDATE(), ?, ?, 'gcash', ?, NULL, 'void_reversal', NULL, ?, ?, 0, 0, NULL, ?)`,
        [
          uuidv4(),
          gcashTxn.account_id,
          parseFloat(gcashTxn.amount ?? 0),
          parseFloat(gcashTxn.amount_received ?? 0),
          parseFloat(gcashTxn.delivery_fee ?? 0),
          `POS Void Reversal - ${sale.receipt_no}`,
          sale.receipt_no,
          `Reversal of POS product payment due to voided sale ${sale.receipt_no}. Reason: ${String(reason).trim()}`,
          sale_id,
          gcashTxn.id,
          actor_id || null,
        ]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('void_sale error:', err.message);
    res.json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/post_return', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const {
      original_sale_id,
      shift_id,
      terminal_id,
      location_id,
      cashier_id,
      supervisor_id = null,
      reason = '',
      refund_method = 'cash',
      total_return_amt = 0,
      notes = '',
      items = [],
    } = payload;

    const [saleRows] = await conn.query(
      'SELECT sale_id, receipt_no, sale_status FROM sales WHERE sale_id = ? LIMIT 1',
      [original_sale_id]
    );
    const sale = saleRows[0];
    if (!sale) {
      await conn.rollback();
      return res.json({ error: 'Original sale not found' });
    }
    if (sale.sale_status === 'voided') {
      await conn.rollback();
      return res.json({ error: 'Cannot return items from a voided sale' });
    }

    const returnSeq = await nextSeq(conn, 'sale_return');
    const returnNo = `RTN-${String(returnSeq).padStart(8, '0')}`;
    const returnId = uuidv4();

    await conn.query(
      `INSERT INTO sale_returns
         (return_id, return_no, original_sale_id, shift_id, terminal_id, location_id,
          cashier_id, supervisor_id, reason, refund_method, total_return_amt, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        returnId,
        returnNo,
        original_sale_id,
        shift_id || null,
        terminal_id || null,
        location_id || null,
        cashier_id || null,
        supervisor_id || null,
        reason || '',
        refund_method || 'cash',
        parseFloat(total_return_amt || 0),
        notes || '',
      ]
    );

    for (const item of items) {
      const qtyReturned = parseFloat(item.qty_returned ?? 0);
      if (qtyReturned <= 0) continue;

      const [saleItemRows] = await conn.query(
        `SELECT
           item_id, qty, product_id, product_name_snapshot, sku_code, unit_price,
           selected_unit_id, selected_unit_name, qty_in_base_unit_per_unit,
           total_base_qty_deducted, base_unit_name, cost_per_base_unit
         FROM sale_items
         WHERE item_id = ?
         LIMIT 1`,
        [item.original_sale_item_id]
      );
      const originalItem = saleItemRows[0];
      if (!originalItem) {
        await conn.rollback();
        return res.json({ error: 'Original sale item not found' });
      }
      const [returnedRows] = await conn.query(
        'SELECT COALESCE(SUM(qty_returned), 0) AS qty_returned FROM sale_return_items WHERE original_sale_item_id = ?',
        [originalItem.item_id]
      );
      const alreadyReturned = parseFloat(returnedRows[0]?.qty_returned ?? 0);
      const returnableQty = parseFloat(originalItem.qty ?? 0) - alreadyReturned;

      if (qtyReturned > returnableQty) {
        await conn.rollback();
        return res.json({ error: `Return quantity exceeds available returnable quantity for ${originalItem.product_name_snapshot}` });
      }

      await conn.query(
        `INSERT INTO sale_return_items
           (id, return_id, original_sale_item_id, product_id, product_name_snapshot,
            sku_code, selected_unit_id, selected_unit_name, qty_returned,
            qty_in_base_unit_per_unit, total_base_qty_restored, base_unit_name, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          returnId,
          originalItem.item_id,
          item.product_id ?? originalItem.product_id ?? null,
          item.product_name_snapshot || originalItem.product_name_snapshot || '',
          item.sku_code || originalItem.sku_code || '',
          item.selected_unit_id ?? originalItem.selected_unit_id ?? null,
          item.selected_unit_name || originalItem.selected_unit_name || '',
          qtyReturned,
          parseFloat(item.qty_in_base_unit_per_unit ?? originalItem.qty_in_base_unit_per_unit ?? 1),
          computeBaseQuantity(
            qtyReturned,
            parseFloat(item.qty_in_base_unit_per_unit ?? originalItem.qty_in_base_unit_per_unit ?? 1)
          ),
          item.base_unit_name || originalItem.base_unit_name || '',
          parseFloat(item.unit_price ?? originalItem.unit_price ?? 0),
          parseFloat(item.subtotal ?? 0),
        ]
      );

      await restoreInventory(conn, {
        productId: item.product_id ?? originalItem.product_id,
        locationId: location_id,
        qty: computeBaseQuantity(
          qtyReturned,
          parseFloat(item.qty_in_base_unit_per_unit ?? originalItem.qty_in_base_unit_per_unit ?? 1)
        ),
        refNumber: returnNo,
        refId: returnId,
        notes: `Sales return ${returnNo} from ${sale.receipt_no}`,
        createdBy: cashier_id || null,
        movementType: 'sale_return',
        displayUnitId: item.selected_unit_id ?? originalItem.selected_unit_id ?? null,
        displayUnitName: item.selected_unit_name || originalItem.selected_unit_name || '',
        displayQty: qtyReturned,
        qtyInBaseUnitPerDisplay: parseFloat(item.qty_in_base_unit_per_unit ?? originalItem.qty_in_base_unit_per_unit ?? 1),
        baseUnitName: item.base_unit_name || originalItem.base_unit_name || '',
        unitCost: originalItem.cost_per_base_unit != null ? parseFloat(originalItem.cost_per_base_unit) : null,
      });
    }

    await conn.commit();
    res.json({ return_id: returnId, return_no: returnNo });
  } catch (err) {
    await conn.rollback();
    console.error('post_return error:', err.message);
    res.json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/deduct_bank_balance ────────────────────────────────
router.post('/deduct_bank_balance', requireAuth, async (req, res) => {
  const { p_bank_account_id, p_amount } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE bank_accounts
       SET current_balance = ROUND(current_balance - ?, 2),
           updated_at = NOW()
       WHERE id = ?`,
      [parseFloat(p_amount), p_bank_account_id]
    );
    const [rows] = await conn.query(
      'SELECT current_balance FROM bank_accounts WHERE id = ?',
      [p_bank_account_id]
    );
    await conn.commit();
    res.json(rows[0]?.current_balance ?? 0);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/add_bank_balance ───────────────────────────────────
router.post('/add_bank_balance', requireAuth, async (req, res) => {
  const { p_bank_account_id, p_amount } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE bank_accounts
       SET current_balance = ROUND(current_balance + ?, 2),
           updated_at = NOW()
       WHERE id = ?`,
      [parseFloat(p_amount), p_bank_account_id]
    );
    const [rows] = await conn.query(
      'SELECT current_balance FROM bank_accounts WHERE id = ?',
      [p_bank_account_id]
    );
    await conn.commit();
    res.json(rows[0]?.current_balance ?? 0);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/post_receiving ─────────────────────────────────────
//
// Posts a receiving transaction:
//   1. Inserts inventory_movements for each item
//   2. Upserts inventory_balances
//   3. Updates purchase_order_items.qty_received
//   4. Updates receiving.status = 'posted'
//
router.post('/post_receiving', requireAuth, async (req, res) => {
  const { p_receiving_id } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Load receiving header
    const [recRows] = await conn.query(
      'SELECT * FROM receivings WHERE id = ?', [p_receiving_id]
    );
    const receiving = recRows[0];
    if (!receiving) {
      await conn.rollback();
      return res.status(404).json({ error: 'Receiving not found' });
    }
    if (receiving.status === 'posted') {
      await conn.rollback();
      return res.status(400).json({ error: 'Already posted' });
    }

    // Load items
    const [items] = await conn.query(
      'SELECT * FROM receiving_items WHERE receiving_id = ?', [p_receiving_id]
    );
    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');

    const productMeta = await loadProductUnitMeta(
      conn,
      items.map(item => item.product_id).filter(Boolean)
    );

    for (const item of items) {
      const qtyAcceptedDisplay = parseFloat(item.qty_accepted ?? Math.max((item.qty_received ?? 0) - (item.qty_rejected ?? 0), 0));
      const qtyPerPurchase = parseFloat(item.qty_in_base_unit_per_purchase ?? 1) || 1;
      const qtyAcceptedBase = parseFloat(item.qty_accepted_in_base_unit ?? computeBaseQuantity(qtyAcceptedDisplay, qtyPerPurchase));
      if (qtyAcceptedBase <= 0) continue;

      const productUnitMeta = productMeta.get(item.product_id);
      const purchaseUnitName = item.purchase_unit_name
        || productUnitMeta?.purchase_unit_name
        || productUnitMeta?.base_unit_name
        || '';
      const baseUnitName = productUnitMeta?.base_unit_name || '';
      const costPerBase = parseFloat(item.unit_cost_per_base ?? computeCostPerBase(item.unit_cost, qtyPerPurchase));

      // Get current balance
      const [balRows] = await conn.query(
        'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
        [item.product_id, receiving.location_id]
      );
      const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
      const qtyAfter  = qtyBefore + qtyAcceptedBase;

      // Insert movement
      await insertCompatibleRow(conn, 'inventory_movements', {
        id: uuidv4(),
        product_id: item.product_id,
        location_id: receiving.location_id,
        movement_type: 'receiving',
        qty_change: qtyAcceptedBase,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        unit_cost: costPerBase,
        ref_number: receiving.receiving_number,
        notes: `Receiving ${receiving.receiving_number}`,
        created_by: req.user.id,
        display_unit_id: item.purchase_unit_id ?? null,
        display_unit_name: purchaseUnitName,
        display_qty: qtyAcceptedDisplay,
        qty_in_base_unit_per_display: qtyPerPurchase,
        base_unit_name: baseUnitName,
      }, movementColumns);

      // Upsert balance
      await conn.query(
        `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
        [uuidv4(), item.product_id, receiving.location_id, qtyAfter, qtyAcceptedBase]
      );

      // Update PO item qty_received
      if (item.po_item_id) {
        await conn.query(
          `UPDATE purchase_order_items
           SET qty_received = qty_received + ?,
               qty_received_in_base_unit = qty_received_in_base_unit + ?
           WHERE id = ?`,
          [qtyAcceptedDisplay, qtyAcceptedBase, item.po_item_id]
        );
      }
    }

    // Update PO status
    const newPoStatus = await getPurchaseOrderReceivingStatus(conn, receiving.po_id);
    await conn.query('UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE id = ?', [
      newPoStatus, receiving.po_id,
    ]);

    // Mark receiving as posted
    await conn.query(
      'UPDATE receivings SET status = "posted", posted_by = ?, posted_at = NOW(), updated_at = NOW() WHERE id = ?',
      [req.user.id, p_receiving_id]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('post_receiving error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/create_payable_from_receiving ──────────────────────
router.post('/create_payable_from_receiving', requireAuth, async (req, res) => {
  const { p_receiving_id } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [recRows] = await conn.query(
      `SELECT r.*, SUM(COALESCE(ri.qty_accepted, ri.qty_received) * ri.unit_cost) AS total_amount
       FROM receivings r
       JOIN receiving_items ri ON ri.receiving_id = r.id
       WHERE r.id = ?
       GROUP BY r.id`,
      [p_receiving_id]
    );
    const rec = recRows[0];
    if (!rec) {
      await conn.rollback();
      return res.status(404).json({ error: 'Receiving not found' });
    }

    // Generate payable number
    const [seqRows] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(payable_number, 5) AS UNSIGNED)) AS mx FROM payables`
    );
    const nextNum    = (seqRows[0]?.mx ?? 0) + 1;
    const payableNum = `PAY-${String(nextNum).padStart(6, '0')}`;
    const payableId  = uuidv4();
    const amount     = parseFloat(rec.total_amount || 0);

    await conn.query(
      `INSERT INTO payables
         (id, payable_number, supplier_id, receiving_id, invoice_number,
          amount, balance, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        payableId, payableNum, rec.supplier_id, p_receiving_id,
        rec.invoice_number, amount, amount, req.user.id,
      ]
    );

    await conn.commit();
    res.json({ payable_id: payableId, payable_number: payableNum });
  } catch (err) {
    await conn.rollback();
    console.error('create_payable_from_receiving error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/delete_receiving ────────────────────────────────────
router.post('/delete_receiving', requireAuth, async (req, res) => {
  const { p_receiving_id } = req.body;
  if (!p_receiving_id) {
    return res.status(400).json({ error: 'Receiving ID is required' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [recRows] = await conn.query(
      'SELECT * FROM receivings WHERE id = ? LIMIT 1',
      [p_receiving_id]
    );
    const receiving = recRows[0];

    if (!receiving) {
      await conn.rollback();
      return res.status(404).json({ error: 'Receiving not found' });
    }

    const [items] = await conn.query(
      'SELECT * FROM receiving_items WHERE receiving_id = ? ORDER BY id ASC',
      [p_receiving_id]
    );
    const [payables] = await conn.query(
      'SELECT id, payable_number FROM payables WHERE receiving_id = ?',
      [p_receiving_id]
    );

    if (payables.length > 0) {
      const payableIds = payables.map((payable) => payable.id);
      const placeholders = payableIds.map(() => '?').join(', ');
      const [paymentRows] = await conn.query(
        `SELECT payable_id, COUNT(*) AS payment_count
           FROM payable_payments
          WHERE payable_id IN (${placeholders})
          GROUP BY payable_id`,
        payableIds
      );

      if (paymentRows.some((row) => Number(row.payment_count ?? 0) > 0)) {
        await conn.rollback();
        return res.status(400).json({
          error: 'Cannot delete this receiving because its payable already has payments. Delete the payable payments first.',
        });
      }
    }

    if (receiving.status === 'posted') {
      for (const item of items) {
        const qtyAcceptedBase = parseFloat(
          item.qty_accepted_in_base_unit
            ?? computeBaseQuantity(
              parseFloat(item.qty_accepted ?? Math.max((item.qty_received ?? 0) - (item.qty_rejected ?? 0), 0)),
              parseFloat(item.qty_in_base_unit_per_purchase ?? 1) || 1
            )
        );

        if (qtyAcceptedBase <= 0) continue;

        const [balRows] = await conn.query(
          'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
          [item.product_id, receiving.location_id]
        );
        const qtyOnHand = parseFloat(balRows[0]?.qty_on_hand ?? 0);
        if ((qtyOnHand + 1e-9) < qtyAcceptedBase) {
          await conn.rollback();
          return res.status(400).json({
            error: `Cannot delete receiving ${receiving.receiving_number} because current stock is already lower than the received quantity for one or more items.`,
          });
        }
      }

      for (const item of items) {
        const qtyAcceptedDisplay = parseFloat(
          item.qty_accepted ?? Math.max((item.qty_received ?? 0) - (item.qty_rejected ?? 0), 0)
        );
        const qtyAcceptedBase = parseFloat(
          item.qty_accepted_in_base_unit
            ?? computeBaseQuantity(qtyAcceptedDisplay, parseFloat(item.qty_in_base_unit_per_purchase ?? 1) || 1)
        );

        if (qtyAcceptedBase > 0) {
          await conn.query(
            `UPDATE inventory_balances
                SET qty_on_hand = GREATEST(qty_on_hand - ?, 0),
                    updated_at = NOW()
              WHERE product_id = ? AND location_id = ?`,
            [qtyAcceptedBase, item.product_id, receiving.location_id]
          );
        }

        if (item.po_item_id) {
          await conn.query(
            `UPDATE purchase_order_items
                SET qty_received = GREATEST(COALESCE(qty_received, 0) - ?, 0),
                    qty_received_in_base_unit = GREATEST(COALESCE(qty_received_in_base_unit, 0) - ?, 0),
                    updated_at = NOW()
              WHERE id = ?`,
            [qtyAcceptedDisplay, qtyAcceptedBase, item.po_item_id]
          );
        }
      }

      await conn.query(
        `DELETE FROM inventory_movements
          WHERE movement_type = 'receiving'
            AND ref_number = ?`,
        [receiving.receiving_number]
      );

      const nextPoStatus = await getPurchaseOrderReceivingStatus(conn, receiving.po_id);
      await conn.query(
        'UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE id = ?',
        [nextPoStatus, receiving.po_id]
      );
    }

    if (payables.length > 0) {
      await conn.query('DELETE FROM payables WHERE receiving_id = ?', [p_receiving_id]);
    }

    await conn.query('DELETE FROM receivings WHERE id = ?', [p_receiving_id]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('delete_receiving error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/issue_stock_transfer ───────────────────────────────
//
// Deducts issued quantities from source location.
//
router.post('/issue_stock_transfer', requireAuth, async (req, res) => {
  const { p_transfer_id, p_issued_by } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [transRows] = await conn.query(
      'SELECT * FROM stock_transfers WHERE id = ?', [p_transfer_id]
    );
    const transfer = transRows[0];
    if (!transfer) {
      await conn.rollback();
      return res.status(404).json({ error: 'Transfer not found' });
    }
    if (transfer.status !== 'approved') {
      await conn.rollback();
      return res.status(400).json({ error: 'Transfer must be approved before issuing' });
    }

    const [items] = await conn.query(
      'SELECT * FROM stock_transfer_items WHERE transfer_id = ?', [p_transfer_id]
    );
    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');

    for (const item of items) {
      const qty = parseFloat(item.qty_requested);
      if (qty <= 0) continue;

      const [balRows] = await conn.query(
        'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
        [item.product_id, transfer.source_location_id]
      );
      const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
      const qtyAfter  = qtyBefore - qty;

      await insertCompatibleRow(conn, 'inventory_movements', {
        id: uuidv4(),
        product_id: item.product_id,
        location_id: transfer.source_location_id,
        movement_type: 'transfer_out',
        qty_change: -qty,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        ref_number: transfer.transfer_number,
        notes: `Transfer out ${transfer.transfer_number}`,
        created_by: p_issued_by || req.user.id,
      }, movementColumns);

      await conn.query(
        `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand - ?`,
        [uuidv4(), item.product_id, transfer.source_location_id, qtyAfter, qty]
      );

      await conn.query(
        'UPDATE stock_transfer_items SET qty_issued = ? WHERE id = ?',
        [qty, item.id]
      );
    }

    await conn.query(
      `UPDATE stock_transfers
       SET status = 'issued', issued_by = ?, issued_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [p_issued_by || req.user.id, p_transfer_id]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('issue_stock_transfer error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/receive_stock_transfer ─────────────────────────────
//
// Adds received quantities to destination location.
//
router.post('/receive_stock_transfer', requireAuth, async (req, res) => {
  const { p_transfer_id, p_transfer_items, p_received_by } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [transRows] = await conn.query(
      'SELECT * FROM stock_transfers WHERE id = ?', [p_transfer_id]
    );
    const transfer = transRows[0];
    if (!transfer) {
      await conn.rollback();
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const itemUpdates = Array.isArray(p_transfer_items) ? p_transfer_items : [];
    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');

    for (const update of itemUpdates) {
      const qty = parseFloat(update.qty_received ?? 0);
      if (qty <= 0) continue;

      const [itemRows] = await conn.query(
        'SELECT * FROM stock_transfer_items WHERE id = ?', [update.id]
      );
      const item = itemRows[0];
      if (!item) continue;

      const [balRows] = await conn.query(
        'SELECT qty_on_hand FROM inventory_balances WHERE product_id = ? AND location_id = ?',
        [item.product_id, transfer.destination_location_id]
      );
      const qtyBefore = parseFloat(balRows[0]?.qty_on_hand ?? 0);
      const qtyAfter  = qtyBefore + qty;

      await insertCompatibleRow(conn, 'inventory_movements', {
        id: uuidv4(),
        product_id: item.product_id,
        location_id: transfer.destination_location_id,
        movement_type: 'transfer_in',
        qty_change: qty,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        ref_number: transfer.transfer_number,
        notes: `Transfer in ${transfer.transfer_number}`,
        created_by: p_received_by || req.user.id,
      }, movementColumns);

      await conn.query(
        `INSERT INTO inventory_balances (id, product_id, location_id, qty_on_hand)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
        [uuidv4(), item.product_id, transfer.destination_location_id, qtyAfter, qty]
      );

      await conn.query(
        'UPDATE stock_transfer_items SET qty_received = qty_received + ? WHERE id = ?',
        [qty, item.id]
      );
    }

    // Determine new status
    const [allItems] = await conn.query(
      'SELECT qty_issued, qty_received FROM stock_transfer_items WHERE transfer_id = ?',
      [p_transfer_id]
    );
    const fullyReceived = allItems.every(
      i => parseFloat(i.qty_received) >= parseFloat(i.qty_issued)
    );
    const newStatus = fullyReceived ? 'fully_received' : 'partially_received';

    await conn.query(
      'UPDATE stock_transfers SET status = ?, updated_at = NOW() WHERE id = ?',
      [newStatus, p_transfer_id]
    );

    await conn.commit();
    res.json({ success: true, status: newStatus });
  } catch (err) {
    await conn.rollback();
    console.error('receive_stock_transfer error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/sync_daily_sales_from_pos ──────────────────────────
//
// Aggregates all completed POS sales for a shift's business_date and
// upserts the totals into daily_sales (total_pos_sales, cash_pos_sales,
// gcash_pos_sales, card_pos_sales, pos_synced_at).
// Called automatically by ZReadingModal after posting a Z-close.
//
router.post('/sync_daily_sales_from_pos', requireAuth, async (req, res) => {
  const { p_shift_id } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const shift = await getShiftForPosting(conn, p_shift_id);
    if (!shift) {
      await conn.rollback();
      return res.status(404).json({ error: 'Shift not found' });
    }
    const summary = await getBusinessDatePosSummary(conn, shift.business_date, shift.terminal_id);
    const dailySales = await upsertDailySalesFromPos(conn, {
      businessDate: shift.business_date,
      userId: req.user.id,
      summary,
    });

    await conn.commit();
    res.json({
      date: shift.business_date,
      ...dailySales,
    });
  } catch (err) {
    await conn.rollback();
    console.error('sync_daily_sales_from_pos error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/reset_z_reading', requireAuth, async (req, res) => {
  const { p_shift_id, p_admin_password, p_reason } = req.body;
  const reason = String(p_reason ?? '').trim();
  const adminPassword = String(p_admin_password ?? '');
  const conn = await pool.getConnection();

  if (!adminPassword) {
    return res.status(400).json({ error: 'Admin password is required.' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'Reset reason is required.' });
  }

  try {
    await conn.beginTransaction();

    const [[adminRows], [shiftRows]] = await Promise.all([
      conn.query(
        'SELECT id, role, password_hash, name FROM profiles WHERE id = ? LIMIT 1',
        [req.user.id]
      ),
      conn.query(
        `SELECT shift_id, terminal_id, location_id, cashier_id, status,
                COALESCE(business_date, shift_date) AS business_date,
                z_reading_posted_at
           FROM pos_shifts
          WHERE shift_id = ?
          LIMIT 1`,
        [p_shift_id]
      ),
    ]);

    const admin = adminRows[0];
    const shift = shiftRows[0];

    if (!admin || admin.role !== 'admin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Admin access is required.' });
    }

    const passwordOk = await bcrypt.compare(adminPassword, admin.password_hash ?? '');
    if (!passwordOk) {
      await conn.rollback();
      return res.status(401).json({ error: 'Admin password is incorrect.' });
    }

    if (!shift) {
      await conn.rollback();
      return res.status(404).json({ error: 'Shift not found.' });
    }

    if (!shift.z_reading_posted_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'This shift does not have a posted Z Reading to reset.' });
    }

    const [otherOpenRows] = await conn.query(
      `SELECT shift_id
         FROM pos_shifts
        WHERE terminal_id = ?
          AND COALESCE(business_date, shift_date) = ?
          AND status = 'open'
          AND shift_id <> ?
        LIMIT 1`,
      [shift.terminal_id, shift.business_date, shift.shift_id]
    );

    if (otherOpenRows[0]) {
      await conn.rollback();
      return res.status(400).json({ error: 'Another open shift already exists for this register/day. Close it first before reopening this one.' });
    }

    const resetAt = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    await conn.query(
      `UPDATE pos_shifts
          SET status = 'closed',
              z_reading_posted_at = NULL,
              z_reading_posted_by = NULL,
              z_reading_reset_at = ?,
              z_reading_reset_by = ?,
              z_reading_reset_reason = ?
        WHERE terminal_id = ?
          AND COALESCE(business_date, shift_date) = ?`,
      [resetAt, req.user.id, reason, shift.terminal_id, shift.business_date]
    );

    await conn.query(
      `UPDATE pos_shifts
          SET status = 'open',
              closed_at = NULL,
              closed_by = NULL
        WHERE shift_id = ?`,
      [shift.shift_id]
    );

    await conn.query(
      `INSERT INTO pos_zreading_resets
         (id, shift_id, terminal_id, location_id, business_date, reset_by, reason, reset_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), shift.shift_id, shift.terminal_id, shift.location_id, shift.business_date, req.user.id, reason, resetAt, resetAt]
    );

    await appendDailySalesResetNote(conn, {
      businessDate: shift.business_date,
      terminalId: shift.terminal_id,
      shiftId: shift.shift_id,
      reason,
      resetAt,
    });

    await conn.commit();
    res.json({
      success: true,
      shift_id: shift.shift_id,
      business_date: shift.business_date,
      reset_at: resetAt,
    });
  } catch (err) {
    await conn.rollback();
    console.error('reset_z_reading error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/post_pos_cash_pickup', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const shiftId = String(payload.p_shift_id ?? payload.shift_id ?? '').trim();
  const pickupAt = toSqlDateTime(payload.p_pickup_at ?? payload.pickup_at, 'pickup time');
  const category = String(payload.p_category ?? payload.category ?? '').trim();
  const reason = String(payload.p_reason ?? payload.reason ?? '').trim();
  const notes = String(payload.p_notes ?? payload.notes ?? '').trim();
  const relatedReference = String(payload.p_related_reference ?? payload.related_reference ?? '').trim();
  const deliveryTransactionIds = Array.from(new Set(
    (Array.isArray(payload.p_delivery_transaction_ids ?? payload.delivery_transaction_ids)
      ? (payload.p_delivery_transaction_ids ?? payload.delivery_transaction_ids)
      : [])
      .map(value => String(value ?? '').trim())
      .filter(Boolean)
  ));
  const manualAmount = parseImportMoney(payload.p_amount ?? payload.amount ?? 0, 'amount');
  const conn = await pool.getConnection();

  if (!shiftId) {
    return res.status(400).json({ error: 'shift_id is required' });
  }
  if (!category) {
    return res.status(400).json({ error: 'category is required' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  try {
    await conn.beginTransaction();

    const shift = await getShiftForPosting(conn, shiftId);
    if (!shift) {
      await conn.rollback();
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.cashier_id !== req.user.id && req.user.role !== 'admin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Only the assigned cashier or an admin can record a cash pickup.' });
    }
    if (shift.status !== 'open' || shift.z_reading_posted_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'Shift is already closed. Cash pickup must be recorded before Z Reading.' });
    }

    let amount = manualAmount;
    let pickupKind = 'general';
    const linkRowsToInsert = [];

    if (deliveryTransactionIds.length > 0) {
      pickupKind = 'delivery_fee';
      const [transactionRows] = await conn.query(
        `SELECT id, source_sale_id, delivery_fee, date
           FROM transactions
          WHERE id IN (?)
            AND is_deleted = 0
            AND transaction_type = 'cash_in'
            AND cash_in_mode = 'payment'`,
        [deliveryTransactionIds]
      );
      const [existingLinkRows] = await conn.query(
        `SELECT source_transaction_id, COALESCE(SUM(linked_amount), 0) AS picked_amount
           FROM pos_cash_pickup_links
          WHERE source_transaction_id IN (?)
          GROUP BY source_transaction_id`,
        [deliveryTransactionIds]
      );

      const transactionMap = new Map(transactionRows.map(row => [String(row.id ?? ''), row]));
      const pickedMap = new Map(existingLinkRows.map(row => [String(row.source_transaction_id ?? ''), roundCurrency(row.picked_amount)]));

      amount = 0;
      for (const transactionId of deliveryTransactionIds) {
        const transaction = transactionMap.get(transactionId);
        if (!transaction) {
          await conn.rollback();
          return res.status(400).json({ error: 'One or more selected delivery fees are no longer available.' });
        }
        if (String(transaction.date ?? '') !== shift.business_date) {
          await conn.rollback();
          return res.status(400).json({ error: 'Selected delivery fees must belong to the same business date as the shift.' });
        }
        const deliveryFee = roundCurrency(transaction.delivery_fee);
        const alreadyPicked = roundCurrency(pickedMap.get(transactionId) ?? 0);
        const outstanding = roundCurrency(Math.max(0, deliveryFee - alreadyPicked));
        if (outstanding <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'One or more selected delivery fees were already picked up.' });
        }
        amount = roundCurrency(amount + outstanding);
        linkRowsToInsert.push({
          id: uuidv4(),
          source_transaction_id: transactionId,
          source_sale_id: transaction.source_sale_id ? String(transaction.source_sale_id) : null,
          linked_amount: outstanding,
        });
      }

      if (manualAmount > 0 && roundCurrency(manualAmount) !== amount) {
        await conn.rollback();
        return res.status(400).json({ error: 'Delivery fee pickup amount no longer matches the selected outstanding delivery fees.' });
      }
    }

    if (amount <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Pickup amount must be greater than zero.' });
    }

    const pickupId = uuidv4();
    await conn.query(
      `INSERT INTO pos_cash_pickups
         (id, shift_id, terminal_id, location_id, business_date, pickup_kind, pickup_at, amount,
          reason, category, related_reference, notes, created_by, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [
        pickupId,
        shift.shift_id,
        shift.terminal_id,
        shift.location_id,
        shift.business_date,
        pickupKind,
        pickupAt,
        amount,
        reason,
        category,
        relatedReference,
        notes,
        req.user.id,
      ]
    );

    for (const linkRow of linkRowsToInsert) {
      await conn.query(
        `INSERT INTO pos_cash_pickup_links
           (id, pickup_id, source_transaction_id, source_sale_id, linked_amount, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          linkRow.id,
          pickupId,
          linkRow.source_transaction_id,
          linkRow.source_sale_id,
          linkRow.linked_amount,
        ]
      );
    }

    await conn.commit();
    res.json({
      pickup_id: pickupId,
      amount,
      pickup_kind: pickupKind,
      linked_delivery_count: linkRowsToInsert.length,
    });
  } catch (err) {
    await conn.rollback();
    console.error('post_pos_cash_pickup error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /rpc/bulk_import ────────────────────────────────────────
//
// Bulk upsert for CSV imports. Supports:
//   entity: 'categories'  → inv_categories  (upsert on code)
//   entity: 'suppliers'   → suppliers        (upsert on code or name)
//   entity: 'products'    → inv_products     (upsert on sku)
//
// Returns: { inserted, updated, skipped, errors[] }
//
router.post('/bulk_import', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const { entity, rows, created_by } = payload;
  const normalizedEntity = String(entity ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalizedEntity || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'entity and rows are required' });
  }

  const conn = await pool.getConnection();
  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];

  try {
    await conn.beginTransaction();

    if (normalizedEntity === 'categories') {
      // Load existing codes for upsert detection
      const [existing] = await conn.query('SELECT id, code FROM inv_categories');
      const byCode = Object.fromEntries(existing.map(r => [r.code.toUpperCase(), r.id]));

      // Load all categories for parent_code resolution
      const [allCats] = await conn.query('SELECT id, code FROM inv_categories');
      const codeToId = Object.fromEntries(allCats.map(r => [r.code.toUpperCase(), r.id]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const code = (row.code || '').trim().toUpperCase();
        const name = (row.name || '').trim();
        if (!code || !name) { errors.push(`Row ${i + 1}: code and name required`); skipped++; continue; }

        const parentCode = (row.parent_code || '').trim().toUpperCase();
        const parent_id = parentCode ? (codeToId[parentCode] ?? null) : null;

        const data = {
          code,
          name,
          parent_id,
          description: (row.description || '').trim(),
          sort_order: parseInt(row.sort_order) || 0,
          is_active: row.is_active === 'false' || row.is_active === false ? 0 : 1,
          updated_at: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        };

        if (byCode[code]) {
          await conn.query('UPDATE inv_categories SET ? WHERE id = ?', [data, byCode[code]]);
          updated++;
        } else {
          await conn.query('INSERT INTO inv_categories SET ?', {
            ...data, id: uuidv4(), created_by: created_by || null,
            created_at: data.updated_at,
          });
          codeToId[code] = '(new)'; // mark as available for later rows as parent
          inserted++;
        }
      }

    } else if (normalizedEntity === 'suppliers') {
      const [existing] = await conn.query('SELECT id, code, name FROM suppliers');
      const supplierColumns = await getTableColumnSet(conn, 'suppliers');
      const byCode = Object.fromEntries(
        existing.filter(r => r.code).map(r => [r.code.toUpperCase(), r.id])
      );
      const byName = Object.fromEntries(existing.map(r => [r.name.toLowerCase(), r.id]));
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = (row.name || '').trim();
        if (!name) { errors.push(`Row ${i + 1}: name required`); skipped++; continue; }

        const code = (row.code || '').trim().toUpperCase() || null;
        const data = {
          name,
          code,
          contact_person: (row.contact_person || '').trim(),
          phone: (row.phone || '').trim(),
          email: (row.email || '').trim(),
          address: (row.address || '').trim(),
          city: (row.city || '').trim(),
          terms: (row.terms || '').trim(),
          notes: (row.notes || '').trim(),
          is_active: row.is_active === 'false' || row.is_active === false ? 0 : 1,
          updated_at: now,
        };

        const supplierData = pickColumns(data, supplierColumns);
        const existingId = (code && byCode[code]) || byName[name.toLowerCase()];
        if (existingId) {
          await conn.query('UPDATE suppliers SET ? WHERE id = ?', [supplierData, existingId]);
          await syncSupplierToInventoryMirror({
            id: existingId,
            ...data,
          }, conn);
          updated++;
        } else {
          const id = uuidv4();
          await conn.query('INSERT INTO suppliers SET ?', pickColumns({
            ...data, id, created_by: created_by || null, created_at: now,
          }, supplierColumns));
          await syncSupplierToInventoryMirror({
            id,
            ...data,
            created_by: created_by || null,
            created_at: now,
          }, conn);
          inserted++;
        }
      }

    } else if (normalizedEntity === 'products') {
      const [[cats], [brands], [units], [sups], [locations]] = await Promise.all([
        conn.query('SELECT id, code FROM inv_categories WHERE is_active = 1'),
        conn.query('SELECT id, name FROM inv_brands WHERE is_active = 1'),
        conn.query('SELECT id, code FROM inv_units WHERE is_active = 1'),
        conn.query('SELECT id, name, code FROM inv_suppliers WHERE is_active = 1'),
        conn.query('SELECT id, code, name FROM inv_locations WHERE is_active = 1 ORDER BY name ASC'),
      ]);
      const catByCode = Object.fromEntries(cats.map((r) => [String(r.code).toUpperCase(), r.id]));
      const brandByName = Object.fromEntries(brands.map((r) => [String(r.name).toLowerCase(), r.id]));
      const unitByCode = Object.fromEntries(units.map((r) => [String(r.code).toUpperCase(), r.id]));
      const supByName = Object.fromEntries(sups.map((r) => [String(r.name).toLowerCase(), r.id]));
      const supByCode = Object.fromEntries(sups.filter((r) => r.code).map((r) => [String(r.code).toUpperCase(), r.id]));
      const locationByCode = Object.fromEntries(locations.map((r) => [String(r.code).toUpperCase(), r.id]));
      const locationByName = Object.fromEntries(locations.map((r) => [String(r.name).toLowerCase(), r.id]));
      const defaultLocationId = locations[0]?.id ?? null;

      const [existingProds] = await conn.query('SELECT id, sku_code FROM inv_products');
      const bySku = Object.fromEntries(existingProds.map((r) => [String(r.sku_code).toUpperCase(), r.id]));
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sku = String(row.code ?? row.sku ?? row.sku_code ?? row.product_code ?? '').trim().toUpperCase();
        const name = String(row.name ?? '').trim();
        if (!sku || !name) { errors.push(`Row ${i + 1}: code and name required`); skipped++; continue; }

        const catCode = String(row.category_code ?? '').trim().toUpperCase();
        const brandNm = String(row.brand_name ?? '').trim().toLowerCase();
        const unitCode = String(row.unit_code ?? '').trim().toUpperCase();
        const supNm = String(row.supplier_name ?? '').trim();
        const supCode = String(row.supplier_code ?? '').trim().toUpperCase();
        const locationCode = String(row.location_code ?? '').trim().toUpperCase();
        const locationName = String(row.location_name ?? '').trim().toLowerCase();

        const category_id = catCode ? (catByCode[catCode] ?? null) : null;
        const brand_id = brandNm ? (brandByName[brandNm] ?? null) : null;
        const unit_id = unitCode ? (unitByCode[unitCode] ?? null) : null;
        const supplier_id = supCode
          ? (supByCode[supCode] ?? null)
          : supNm ? (supByName[supNm.toLowerCase()] ?? null) : null;
        const location_id = locationCode
          ? (locationByCode[locationCode] ?? null)
          : locationName ? (locationByName[locationName] ?? null) : defaultLocationId;

        let importQty = null;
        try {
          importQty = parseOptionalImportQuantity(
            row.qty ?? row.quantity ?? row.qty_on_hand ?? row.current_stock ?? row.balance,
            `Row ${i + 1} qty`
          );
        } catch (rowError) {
          errors.push(rowError instanceof Error ? rowError.message : `Row ${i + 1}: invalid qty`);
          skipped++;
          continue;
        }

        if (importQty !== null && !location_id) {
          errors.push(`Row ${i + 1}: no active inventory location found for qty import`);
          skipped++;
          continue;
        }

        const costPrice = parseFloat(String(row.cost ?? row.cost_price ?? 0)) || 0;
        const retailPrice = parseFloat(String(row.retail_price ?? row.selling_price ?? 0)) || 0;
        const data = {
          sku_code: sku,
          barcode: String(row.barcode ?? '').trim(),
          barcode2: String(row.barcode_alt ?? row.barcode2 ?? '').trim(),
          name,
          description: String(row.description ?? row.notes ?? '').trim(),
          category_id,
          brand_id,
          unit_id,
          base_unit_id: unit_id,
          default_purchase_unit_id: unit_id,
          supplier_id,
          cost_price: costPrice,
          default_cost: costPrice,
          retail_price: retailPrice,
          wholesale_price: parseFloat(String(row.wholesale_price ?? 0)) || 0,
          special_price: parseFloat(String(row.special_price ?? 0)) || 0,
          reorder_point: parseFloat(String(row.reorder_level ?? row.reorder_point ?? 0)) || 0,
          is_expiry_tracked: row.expiry_tracked === 'true' || row.expiry_tracked === true || row.is_expiry_tracked === 'true' || row.is_expiry_tracked === true ? 1 : 0,
          is_active: row.is_active === 'false' || row.is_active === false ? 0 : 1,
          updated_at: now,
        };
        data.selling_price = data.retail_price;

        let productId = bySku[sku];
        if (productId) {
          await conn.query('UPDATE inv_products SET ? WHERE id = ?', [data, productId]);
          updated++;
        } else {
          productId = uuidv4();
          await conn.query('INSERT INTO inv_products SET ?', {
            ...data, id: productId, created_by: created_by || null, created_at: now,
          });
          bySku[sku] = productId;
          inserted++;
        }

        if (importQty !== null && productId && location_id) {
          await applyImportedInventoryBalance(conn, {
            productId,
            locationId: location_id,
            targetQty: importQty,
            actorId: created_by || null,
            adjustmentDate: new Date().toISOString().slice(0, 10),
            remarks: `CSV product import for ${sku}`,
          });
        }
      }

    } else if (normalizedEntity === 'daily_sales') {
      const [existingRows] = await conn.query('SELECT id, date FROM daily_sales WHERE is_deleted = 0');
      const byDate = Object.fromEntries(existingRows.map(r => [String(r.date).slice(0, 10), r.id]));
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          const date = parseImportDate(row.date, `Row ${i + 1} date`);
          const sales = parseImportMoney(row.sales, `Row ${i + 1} sales`);
          const costOfSales = parseImportMoney(row.cost_of_sales, `Row ${i + 1} cost_of_sales`);
          const data = {
            date,
            description: String(row.description ?? '').trim(),
            notes: String(row.notes ?? '').trim(),
            sales,
            cost_of_sales: costOfSales,
            updated_at: now,
            is_deleted: 0,
          };

          if (byDate[date]) {
            await conn.query(
              `UPDATE daily_sales
                  SET date = ?, description = ?, notes = ?, sales = ?, cost_of_sales = ?, is_deleted = 0, updated_at = ?
                WHERE id = ?`,
              [data.date, data.description, data.notes, data.sales, data.cost_of_sales, data.updated_at, byDate[date]]
            );
            updated++;
          } else {
            await conn.query('INSERT INTO daily_sales SET ?', {
              id: uuidv4(),
              ...data,
              created_by: created_by || null,
              created_at: now,
            });
            inserted++;
          }
        } catch (rowError) {
          errors.push(rowError instanceof Error ? rowError.message : `Row ${i + 1}: invalid data`);
          skipped++;
        }
      }

    } else {
      await conn.rollback();
      return res.status(400).json({ error: `Unknown entity: ${entity}` });
    }

    await conn.commit();
    res.json({ inserted, updated, skipped, errors });
  } catch (err) {
    await conn.rollback();
    console.error('bulk_import error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

function getRpcInput(req) {
  if (req.method === 'GET') {
    return req.query ?? {};
  }
  return req.body?.payload ?? req.body ?? {};
}

router.post('/quick_adjust_inventory_balance', requireAuth, async (req, res) => {
  const {
    product_id = '',
    location_id = '',
    new_qty,
    notes = '',
    adjustment_date = new Date().toISOString().slice(0, 10),
  } = getRpcInput(req);

  const productId = String(product_id).trim();
  const locationId = String(location_id).trim();
  const targetQty = Number(new_qty);
  const remarksInput = String(notes ?? '').trim();

  if (!productId) {
    return res.status(400).json({ error: 'Product is required' });
  }

  if (!locationId) {
    return res.status(400).json({ error: 'Location is required' });
  }

  if (!Number.isFinite(targetQty) || targetQty < 0) {
    return res.status(400).json({ error: 'New balance must be a valid non-negative quantity' });
  }

  const normalizedDate = parseImportDate(adjustment_date, 'Adjustment date');
  const actorId = req.user?.id ?? null;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [productRows] = await conn.query(
      `SELECT id, name, sku_code, COALESCE(default_cost, cost_price, 0) AS unit_cost
         FROM inv_products
        WHERE id = ?
        LIMIT 1`,
      [productId]
    );

    const product = productRows[0];
    if (!product) {
      await conn.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    const { balanceColumns, balance, qtyBefore, qtyAvailableBefore } = await getInventoryBalanceSnapshot(
      conn,
      productId,
      locationId,
    );
    const qtyAfter = Number(targetQty.toFixed(3));
    const qtyChange = Number((qtyAfter - qtyBefore).toFixed(3));

    if (Math.abs(qtyChange) < 0.0005) {
      await conn.rollback();
      return res.json({
        success: true,
        no_change: true,
        qty_before: qtyBefore,
        qty_change: 0,
        qty_after: qtyAfter,
      });
    }

    const direction = qtyChange > 0 ? 'add' : 'deduct';
    const movementType = direction === 'add' ? 'adjustment_add' : 'adjustment_deduct';
    const now = toSqlDateTime(new Date().toISOString());
    const adjustmentId = uuidv4();
    const adjustmentNumber = await nextAdjustmentNumber(conn, normalizedDate);
    const movementId = uuidv4();
    const itemId = uuidv4();
    const changeLabel = `${qtyChange > 0 ? '+' : ''}${qtyChange}`;
    const remarks = remarksInput || `Quick balance edit for ${product.name}`;
    const itemNotes = `Before: ${qtyBefore} | Change: ${changeLabel} | After: ${qtyAfter}${remarksInput ? ` | ${remarksInput}` : ''}`;

    const adjustmentsColumns = await getTableColumnSet(conn, 'adjustments');
    await insertCompatibleRow(conn, 'adjustments', {
      id: adjustmentId,
      adjustment_number: adjustmentNumber,
      adj_number: adjustmentNumber,
      location_id: locationId,
      adjustment_date: normalizedDate,
      adj_date: normalizedDate,
      reason: 'system_correction',
      direction,
      adj_type: direction === 'add' ? 'addition' : 'deduction',
      remarks,
      status: 'posted',
      approved_by: actorId,
      approved_at: now,
      posted_by: actorId,
      posted_at: now,
      created_by: actorId,
      updated_by: actorId,
      created_at: now,
      updated_at: now,
    }, adjustmentsColumns);

    const movementColumns = await getTableColumnSet(conn, 'inventory_movements');
    await insertCompatibleRow(conn, 'inventory_movements', {
      id: movementId,
      product_id: productId,
      location_id: locationId,
      movement_type: movementType,
      qty_change: qtyChange,
      qty_before: qtyBefore,
      qty_after: qtyAfter,
      unit_cost: Number(product.unit_cost ?? 0),
      ref_number: adjustmentNumber,
      notes: itemNotes,
      created_by: actorId,
      created_at: now,
      updated_at: now,
    }, movementColumns);

    const adjustmentItemColumns = await getTableColumnSet(conn, 'adjustment_items');
    await insertCompatibleRow(conn, 'adjustment_items', {
      id: itemId,
      adjustment_id: adjustmentId,
      product_id: productId,
      qty: Math.abs(qtyChange),
      unit_cost: Number(product.unit_cost ?? 0),
      notes: itemNotes,
      sort_order: 1,
      movement_id: movementId,
      qty_before: qtyBefore,
      qty_adjusted: qtyChange,
      qty_after: qtyAfter,
      reason: itemNotes,
      created_at: now,
      updated_at: now,
    }, adjustmentItemColumns);

    if (balance) {
      await updateCompatibleRows(conn, 'inventory_balances', 'product_id = ? AND location_id = ?', [productId, locationId], {
        qty_on_hand: qtyAfter,
        qty_available: qtyAvailableBefore + qtyChange,
        last_movement_at: now,
        updated_at: now,
      }, balanceColumns);
    } else {
      await insertCompatibleRow(conn, 'inventory_balances', {
        id: uuidv4(),
        product_id: productId,
        location_id: locationId,
        qty_on_hand: qtyAfter,
        qty_available: qtyAfter,
        last_movement_at: now,
        created_at: now,
        updated_at: now,
      }, balanceColumns);
    }

    await conn.commit();
    res.json({
      success: true,
      adjustment_id: adjustmentId,
      adjustment_number: adjustmentNumber,
      qty_before: qtyBefore,
      qty_change: qtyChange,
      qty_after: qtyAfter,
    });
  } catch (err) {
    await conn.rollback();
    console.error('quick_adjust_inventory_balance error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── /rpc/price_check ─────────────────────────────────────────────
//
// Public product lookup for the shared tablet price checker screen.
// Returns active products with retail price and total stock balance.
//
async function handlePriceCheck(req, res) {
  const { search = '' } = getRpcInput(req);
  const q = String(search ?? '').trim();

  if (!q) {
    return res.json({ products: [] });
  }

  const like = `%${q}%`;

  try {
    const [products] = await pool.query(
      `SELECT
         p.id,
         COALESCE(p.sku_code, '') AS sku_code,
         COALESCE(p.barcode, '') AS barcode,
         COALESCE(p.barcode2, '') AS barcode2,
         p.name,
         COALESCE(p.retail_price, p.selling_price, 0) AS retail_price,
         COALESCE(p.selling_price, p.retail_price, 0) AS selling_price,
         COALESCE(p.wholesale_price, 0) AS wholesale_price,
         COALESCE(p.special_price, 0) AS special_price,
         COALESCE(u.code, '') AS unit_code,
         ROUND(COALESCE(SUM(ib.qty_on_hand), 0), 3) AS qty_on_hand
       FROM inv_products p
       LEFT JOIN inv_units u
         ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.unit_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN inventory_balances ib
         ON CONVERT(ib.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       WHERE p.is_active = 1
         AND (
           CONVERT(p.name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?
           OR CONVERT(p.sku_code USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?
           OR CONVERT(p.barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?
           OR CONVERT(p.barcode2 USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?
         )
       GROUP BY p.id, p.sku_code, p.barcode, p.barcode2, p.name, p.retail_price, p.selling_price, p.wholesale_price, p.special_price, u.code
       ORDER BY
         CASE
           WHEN CONVERT(p.barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci THEN 0
           WHEN CONVERT(p.barcode2 USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci THEN 0
           WHEN CONVERT(p.sku_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci THEN 1
           WHEN CONVERT(p.name USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci THEN 2
           ELSE 3
         END,
         p.name ASC
       LIMIT 12`,
      [like, like, like, like, q, q, q, q]
    );

    res.json({ products });
  } catch (err) {
    console.error('price_check error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.get('/price_check', handlePriceCheck);
router.post('/price_check', handlePriceCheck);

// ── /rpc/search_products ─────────────────────────────────────────
//
// Paginated product search across name, sku_code, barcode, barcode2.
// Uses explicit collation on legacy ID joins so upgraded databases with mixed
// MySQL/MariaDB defaults keep working without catalog lookup errors.
// Returns { products: [...], total: N } with joined category/brand/unit names.
//
async function handleSearchProducts(req, res) {
  const {
    search        = '',
    filter_active = 'active',
    filter_category = '',
    page          = 1,
    page_size     = 50,
  } = getRpcInput(req);

  const conditions = [];
  const params     = [];

  const q = search.trim();
  if (q) {
    conditions.push(
      '(CONVERT(p.name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ? OR CONVERT(p.sku_code USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ? OR CONVERT(p.barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ? OR CONVERT(p.barcode2 USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?)'
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  if (filter_active === 'active')   { conditions.push('p.is_active = 1'); }
  if (filter_active === 'inactive') { conditions.push('p.is_active = 0'); }
  if (filter_category)              { conditions.push('CONVERT(p.category_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci'); params.push(filter_category); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * page_size;

  try {
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM inv_products p ${where}`,
      params
    );

      const [products] = await pool.query(
        `SELECT
           p.id, p.sku_code, p.barcode, p.barcode2, p.name,
           p.category_id, p.brand_id, p.unit_id, p.base_unit_id, p.default_purchase_unit_id, p.default_selling_unit_id, p.supplier_id,
           p.cost_price, p.default_cost, p.retail_price, p.wholesale_price, p.special_price,
           p.selling_price, p.reorder_point,
           p.is_expiry_tracked, p.is_active, p.description,
          p.created_at, p.updated_at,
          c.name  AS category_name,
          b.name  AS brand_name,
          u.code  AS unit_code,
          bu.code AS base_unit_code,
          bu.name AS base_unit_name,
          pu.code AS default_purchase_unit_code,
          pu.name AS default_purchase_unit_name,
          su_u.code AS default_selling_unit_code,
          su_u.name AS default_selling_unit_name,
          s.name  AS supplier_name
        FROM inv_products p
        LEFT JOIN inv_categories c ON CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.category_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_brands     b ON CONVERT(b.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.brand_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_units      u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.unit_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_units      bu ON CONVERT(bu.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(COALESCE(p.base_unit_id, p.unit_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_units      pu ON CONVERT(pu.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(COALESCE(p.default_purchase_unit_id, p.unit_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_product_selling_units su ON CONVERT(su.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.default_selling_unit_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_units      su_u ON CONVERT(su_u.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(su.unit_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        LEFT JOIN inv_suppliers  s ON CONVERT(s.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.supplier_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        ${where}
        ORDER BY p.name ASC
        LIMIT ? OFFSET ?`,
      [...params, Number(page_size), Number(offset)]
    );

    res.json({ products, total: Number(countRow.total) });
  } catch (err) {
    console.error('search_products error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.get('/search_products', requireAuth, handleSearchProducts);
router.post('/search_products', requireAuth, handleSearchProducts);

// ── /rpc/search_stock_balances ──────────────────────────────────
//
// Server-side JOIN search for stock list page.
// Returns { balances: [...], total: N } with nested inv_products/inv_locations shape.
//
async function handleSearchStockBalances(req, res) {
  const {
    search        = '',
    filter_location  = '',
    filter_category  = '',
    filter_brand     = '',
    filter_low_stock: rawFilterLowStock = false,
    page      = 1,
    page_size = 30,
  } = getRpcInput(req);
  const filter_low_stock = rawFilterLowStock === true || rawFilterLowStock === 'true' || rawFilterLowStock === 1 || rawFilterLowStock === '1';

  const conditions = ['p.is_active = 1'];
  const params     = [];

  const q = search.trim();
  if (q) {
    conditions.push('(p.name COLLATE utf8mb4_unicode_ci LIKE ? OR p.sku_code COLLATE utf8mb4_unicode_ci LIKE ? OR p.barcode COLLATE utf8mb4_unicode_ci LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  if (filter_location) { conditions.push('ib.location_id COLLATE utf8mb4_unicode_ci = ?'); params.push(filter_location); }
  if (filter_category) { conditions.push('p.category_id COLLATE utf8mb4_unicode_ci = ?');  params.push(filter_category); }
  if (filter_brand)    { conditions.push('p.brand_id COLLATE utf8mb4_unicode_ci = ?');      params.push(filter_brand); }
  if (filter_low_stock) conditions.push('p.reorder_point > 0 AND ib.qty_on_hand <= p.reorder_point');

  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (Math.max(1, page) - 1) * page_size;

  const joins = `
    FROM inventory_balances ib
    INNER JOIN inv_products  p ON p.id COLLATE utf8mb4_unicode_ci = ib.product_id COLLATE utf8mb4_unicode_ci
    INNER JOIN inv_locations l ON l.id COLLATE utf8mb4_unicode_ci = ib.location_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN inv_categories c ON c.id COLLATE utf8mb4_unicode_ci = p.category_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN inv_brands     b ON b.id COLLATE utf8mb4_unicode_ci = p.brand_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN inv_units      u ON u.id COLLATE utf8mb4_unicode_ci = p.unit_id COLLATE utf8mb4_unicode_ci
    ${where}`;

  try {
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total ${joins}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         ib.id, ib.product_id, ib.location_id, ib.qty_on_hand, ib.updated_at,
         p.sku_code, p.name AS product_name, p.reorder_point, p.is_active,
         c.name AS category_name, b.name AS brand_name, u.code AS unit_code,
         l.name AS location_name, l.code AS location_code
       ${joins}
       ORDER BY p.name ASC, l.name ASC
       LIMIT ? OFFSET ?`,
      [...params, Number(page_size), Number(offset)]
    );

    const balances = rows.map(r => ({
      id:          r.id,
      product_id:  r.product_id,
      location_id: r.location_id,
      qty_on_hand: r.qty_on_hand,
      updated_at:  r.updated_at,
      inv_products: {
        id:            r.product_id,
        sku_code:      r.sku_code,
        name:          r.product_name,
        reorder_point: r.reorder_point,
        is_active:     !!r.is_active,
        inv_categories: r.category_name ? { name: r.category_name } : null,
        inv_brands:     r.brand_name    ? { name: r.brand_name }    : null,
        inv_units:      r.unit_code     ? { code: r.unit_code }     : null,
      },
      inv_locations: {
        id:   r.location_id,
        name: r.location_name,
        code: r.location_code,
      },
    }));

    res.json({ balances, total: countRow.total });
  } catch (err) {
    console.error('search_stock_balances error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.get('/search_stock_balances', requireAuth, handleSearchStockBalances);
router.post('/search_stock_balances', requireAuth, handleSearchStockBalances);

// ── /rpc/search_customers ────────────────────────────────────────
async function handleSearchCustomers(req, res) {
  const { search = '', page = 1, page_size = 20 } = getRpcInput(req);
  const q      = String(search).trim();
  const limit  = Math.min(Number(page_size) || 20, 100);
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const conditions = ['c.is_active = 1'];
  const params     = [];

  if (q) {
    conditions.push(
      '(c.first_name COLLATE utf8mb4_unicode_ci LIKE ? OR c.last_name COLLATE utf8mb4_unicode_ci LIKE ? OR CONCAT(c.first_name," ",c.last_name) COLLATE utf8mb4_unicode_ci LIKE ? OR c.phone COLLATE utf8mb4_unicode_ci LIKE ? OR c.email COLLATE utf8mb4_unicode_ci LIKE ? OR COALESCE(c.address, "") COLLATE utf8mb4_unicode_ci LIKE ?)'
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM pos_customers c ${where}`, params
    );
    const total = countRows[0]?.total ?? 0;

    const [rows] = await pool.query(
      `SELECT c.* FROM pos_customers c ${where}
       ORDER BY c.first_name, c.last_name
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ customers: rows, total });
  } catch (err) {
    console.error('search_customers error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.get('/search_customers', requireAuth, handleSearchCustomers);
router.post('/search_customers', requireAuth, handleSearchCustomers);

// ── Payroll Module ────────────────────────────────────────────

router.post('/search_employees', requireAuth, async (req, res) => {
  const { search = '', department_id = '', status = 'active', page = 1, page_size = 50 } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (search) {
      where += ' AND (e.employee_code LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ? OR e.mobile LIKE ? OR CONCAT(e.first_name, \' \', e.last_name) LIKE ? OR CONCAT(e.last_name, \', \', e.first_name) LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status === 'active') { where += ' AND e.is_active = 1'; }
    else if (status === 'inactive') { where += ' AND e.is_active = 0'; }

    const countSql = `SELECT COUNT(*) as total FROM hr_employees e WHERE ${where}`;
    const [[{ total }]] = await pool.query(countSql, params);

    const offset = (page - 1) * page_size;
    const sql = `
      SELECT e.*, d.name as department_name, p.name as position_name
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id
      LEFT JOIN hr_positions p ON p.id = e.position_id
      WHERE ${where}
      ORDER BY e.last_name ASC, e.first_name ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(sql, [...params, page_size, offset]);
    return res.json({ employees: rows, total, page, page_size });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_employee', requireAuth, async (req, res) => {
  const { employee_id } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
  try {
    const [[emp]] = await pool.query(
      `SELECT e.*, d.name as department_name, p.name as position_name
       FROM hr_employees e
       LEFT JOIN hr_departments d ON d.id = e.department_id
       LEFT JOIN hr_positions p ON p.id = e.position_id
       WHERE e.id = ? LIMIT 1`,
      [employee_id]
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const [rateHistory] = await pool.query(
      'SELECT * FROM hr_rate_history WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 20',
      [employee_id]
    );
    return res.json({ employee: emp, rate_history: rateHistory });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/save_employee', requireAuth, async (req, res) => {
  const { employee, updated_by } = req.body;
  if (!employee) return res.status(400).json({ error: 'employee required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const isNew = !employee.id;
    const empId = employee.id || uuidv4();
    const now = new Date();

    if (isNew) {
      const [[existing]] = await conn.query('SELECT id FROM hr_employees WHERE employee_code = ?', [employee.employee_code]);
      if (existing) { await conn.rollback(); conn.release(); return res.status(400).json({ error: 'Employee code already exists' }); }

      await conn.query(`
        INSERT INTO hr_employees (id, employee_code, first_name, middle_name, last_name, gender, birthdate, civil_status,
          address, mobile, email, emergency_contact_name, emergency_contact_phone, date_hired, employment_status,
          department_id, position_id, branch, payroll_type, basic_monthly_rate, daily_rate, hourly_rate, rest_day,
          tax_type, sss_number, philhealth_number, pagibig_number, tin, bank_account, payment_method,
          overtime_eligible, holiday_pay_eligible, fixed_allowance, notes, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        empId, employee.employee_code, employee.first_name, employee.middle_name || null, employee.last_name,
        employee.gender || 'Male', employee.birthdate || null, employee.civil_status || 'Single',
        employee.address || null, employee.mobile || null, employee.email || null,
        employee.emergency_contact_name || null, employee.emergency_contact_phone || null,
        employee.date_hired || null, employee.employment_status || 'Regular',
        employee.department_id || null, employee.position_id || null, employee.branch || null,
        employee.payroll_type || 'Monthly',
        parseFloat(employee.basic_monthly_rate) || 0,
        parseFloat(employee.daily_rate) || 0,
        parseFloat(employee.hourly_rate) || 0,
        employee.rest_day || 'Sunday', employee.tax_type || 'Taxable',
        employee.sss_number || null, employee.philhealth_number || null, employee.pagibig_number || null,
        employee.tin || null, employee.bank_account || null, employee.payment_method || 'Cash',
        employee.overtime_eligible != null ? (employee.overtime_eligible ? 1 : 0) : 1,
        employee.holiday_pay_eligible != null ? (employee.holiday_pay_eligible ? 1 : 0) : 1,
        parseFloat(employee.fixed_allowance) || 0,
        employee.notes || null,
        employee.is_active != null ? (employee.is_active ? 1 : 0) : 1,
      ]);
    } else {
      const [[oldEmp]] = await conn.query('SELECT basic_monthly_rate, daily_rate FROM hr_employees WHERE id = ?', [empId]);
      const newMonthly = parseFloat(employee.basic_monthly_rate) || 0;
      const newDaily = parseFloat(employee.daily_rate) || 0;
      if (oldEmp && (oldEmp.basic_monthly_rate != newMonthly || oldEmp.daily_rate != newDaily)) {
        await conn.query(`
          INSERT INTO hr_rate_history (id, employee_id, effective_date, old_monthly_rate, new_monthly_rate, old_daily_rate, new_daily_rate, reason, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [uuidv4(), empId, now.toISOString().slice(0,10), oldEmp.basic_monthly_rate, newMonthly, oldEmp.daily_rate, newDaily, employee.rate_change_reason || 'Rate updated', updated_by || null]);
      }

      await conn.query(`
        UPDATE hr_employees SET
          first_name=?, middle_name=?, last_name=?, gender=?, birthdate=?, civil_status=?,
          address=?, mobile=?, email=?, emergency_contact_name=?, emergency_contact_phone=?,
          date_hired=?, employment_status=?, department_id=?, position_id=?, branch=?,
          payroll_type=?, basic_monthly_rate=?, daily_rate=?, hourly_rate=?, rest_day=?,
          tax_type=?, sss_number=?, philhealth_number=?, pagibig_number=?, tin=?,
          bank_account=?, payment_method=?, overtime_eligible=?, holiday_pay_eligible=?,
          fixed_allowance=?, notes=?, is_active=?
        WHERE id=?
      `, [
        employee.first_name, employee.middle_name || null, employee.last_name,
        employee.gender || 'Male', employee.birthdate || null, employee.civil_status || 'Single',
        employee.address || null, employee.mobile || null, employee.email || null,
        employee.emergency_contact_name || null, employee.emergency_contact_phone || null,
        employee.date_hired || null, employee.employment_status || 'Regular',
        employee.department_id || null, employee.position_id || null, employee.branch || null,
        employee.payroll_type || 'Monthly',
        parseFloat(employee.basic_monthly_rate) || 0,
        parseFloat(employee.daily_rate) || 0,
        parseFloat(employee.hourly_rate) || 0,
        employee.rest_day || 'Sunday', employee.tax_type || 'Taxable',
        employee.sss_number || null, employee.philhealth_number || null, employee.pagibig_number || null,
        employee.tin || null, employee.bank_account || null, employee.payment_method || 'Cash',
        employee.overtime_eligible != null ? (employee.overtime_eligible ? 1 : 0) : 1,
        employee.holiday_pay_eligible != null ? (employee.holiday_pay_eligible ? 1 : 0) : 1,
        parseFloat(employee.fixed_allowance) || 0,
        employee.notes || null,
        employee.is_active != null ? (employee.is_active ? 1 : 0) : 1,
        empId,
      ]);
    }
    await conn.commit();
    return res.json({ success: true, employee_id: empId });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/search_payroll_cutoffs', requireAuth, async (req, res) => {
  const { year, status = '', page = 1, page_size = 24 } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (year) { where += ' AND payroll_year = ?'; params.push(year); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM payroll_cutoffs WHERE ${where}`, params);
    const offset = (page - 1) * page_size;
    const [rows] = await pool.query(
      `SELECT * FROM payroll_cutoffs WHERE ${where} ORDER BY date_from DESC LIMIT ? OFFSET ?`,
      [...params, page_size, offset]
    );
    return res.json({ cutoffs: rows, total, page, page_size });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/save_payroll_cutoff', requireAuth, async (req, res) => {
  const { cutoff, created_by } = req.body;
  if (!cutoff) return res.status(400).json({ error: 'cutoff required' });
  try {
    const isNew = !cutoff.cutoff_id && !cutoff.id;
    const id = cutoff.cutoff_id || cutoff.id || uuidv4();
    if (isNew) {
      await pool.query(
        'INSERT INTO payroll_cutoffs (id, period_name, date_from, date_to, payroll_month, payroll_year, cutoff_seq, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, cutoff.period_name, cutoff.date_from, cutoff.date_to, cutoff.payroll_month, cutoff.payroll_year, cutoff.cutoff_seq || 1, cutoff.status || 'Open', cutoff.notes || null, created_by || null]
      );
    } else {
      if (cutoff.status === 'Finalized') return res.status(400).json({ error: 'Cannot edit a finalized cutoff' });
      await pool.query(
        'UPDATE payroll_cutoffs SET period_name=?, date_from=?, date_to=?, payroll_month=?, payroll_year=?, cutoff_seq=?, notes=? WHERE id=?',
        [cutoff.period_name, cutoff.date_from, cutoff.date_to, cutoff.payroll_month, cutoff.payroll_year, cutoff.cutoff_seq || 1, cutoff.notes || null, id]
      );
    }
    return res.json({ success: true, cutoff_id: id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/search_attendance', requireAuth, async (req, res) => {
  const { cutoff_id = '', employee_id = '', date_from = '', date_to = '', page = 1, page_size = 200 } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (cutoff_id) { where += ' AND a.cutoff_id = ?'; params.push(cutoff_id); }
    if (employee_id) { where += ' AND a.employee_id = ?'; params.push(employee_id); }
    if (date_from) { where += ' AND a.work_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND a.work_date <= ?'; params.push(date_to); }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM payroll_attendance a WHERE ${where}`, params);
    const offset = (page - 1) * page_size;
    const [rows] = await pool.query(
      `SELECT a.*, CONCAT(e.last_name, ', ', e.first_name) as employee_name, e.employee_code
       FROM payroll_attendance a
       LEFT JOIN hr_employees e ON e.id = a.employee_id
       WHERE ${where}
       ORDER BY a.work_date ASC, e.last_name ASC
       LIMIT ? OFFSET ?`,
      [...params, page_size, offset]
    );
    return res.json({ attendance: rows, total, page, page_size });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/save_attendance', requireAuth, async (req, res) => {
  const { record } = req.body;
  if (!record || !record.employee_id || !record.work_date) return res.status(400).json({ error: 'employee_id and work_date required' });
  try {
    const isNew = !record.id;
    const id = record.id || uuidv4();
    const fields = {
      employee_id: record.employee_id,
      cutoff_id: record.cutoff_id || null,
      work_date: record.work_date,
      time_in: record.time_in || null,
      time_out: record.time_out || null,
      hours_worked: parseFloat(record.hours_worked) || 0,
      late_minutes: parseFloat(record.late_minutes) || 0,
      undertime_minutes: parseFloat(record.undertime_minutes) || 0,
      overtime_hours: parseFloat(record.overtime_hours) || 0,
      is_absent: record.is_absent ? 1 : 0,
      is_rest_day: record.is_rest_day ? 1 : 0,
      holiday_type: record.holiday_type || 'None',
      holiday_name: record.holiday_name || null,
      remarks: record.remarks || null,
      source: record.source || 'Manual',
    };
    if (isNew) {
      await pool.query(
        `INSERT INTO payroll_attendance (id, employee_id, cutoff_id, work_date, time_in, time_out, hours_worked, late_minutes, undertime_minutes, overtime_hours, is_absent, is_rest_day, holiday_type, holiday_name, remarks, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, fields.employee_id, fields.cutoff_id, fields.work_date, fields.time_in, fields.time_out, fields.hours_worked, fields.late_minutes, fields.undertime_minutes, fields.overtime_hours, fields.is_absent, fields.is_rest_day, fields.holiday_type, fields.holiday_name, fields.remarks, fields.source]
      );
    } else {
      await pool.query(
        `UPDATE payroll_attendance SET cutoff_id=?, time_in=?, time_out=?, hours_worked=?, late_minutes=?, undertime_minutes=?, overtime_hours=?, is_absent=?, is_rest_day=?, holiday_type=?, holiday_name=?, remarks=? WHERE id=?`,
        [fields.cutoff_id, fields.time_in, fields.time_out, fields.hours_worked, fields.late_minutes, fields.undertime_minutes, fields.overtime_hours, fields.is_absent, fields.is_rest_day, fields.holiday_type, fields.holiday_name, fields.remarks, id]
      );
    }
    return res.json({ success: true, id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Attendance record already exists for this employee on this date' });
    return res.status(500).json({ error: err.message });
  }
});

router.post('/import_biometrics', requireAuth, async (req, res) => {
  const { rows, cutoff_id, batch_name, created_by } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const batchId = uuidv4();
    let imported = 0, skipped = 0, errors = 0;
    const errorList = [];

    const dates = [...new Set(rows.map(r => String(r.work_date || '').slice(0, 10)).filter(Boolean))];
    let holidays = [];
    if (dates.length > 0) {
      const [hRows] = await conn.query(
        `SELECT holiday_date, holiday_type, holiday_name FROM payroll_holidays WHERE holiday_date IN (${dates.map(() => '?').join(',')}) AND is_active = 1`,
        dates
      );
      holidays = hRows;
    }
    const holidayMap = {};
    for (const h of holidays) holidayMap[String(h.holiday_date).slice(0, 10)] = h;

    for (const row of rows) {
      try {
        const empCode = String(row.employee_code || '').trim();
        if (!empCode || !row.work_date) { errors++; errorList.push(`Missing employee_code or work_date`); continue; }

        const [[emp]] = await conn.query('SELECT id FROM hr_employees WHERE employee_code = ? AND is_active = 1 LIMIT 1', [empCode]);
        if (!emp) { skipped++; errorList.push(`Employee not found: ${empCode}`); continue; }

        const workDate = String(row.work_date).slice(0, 10);
        const holiday = holidayMap[workDate];

        const recordId = uuidv4();
        await conn.query(
          `INSERT INTO payroll_attendance (id, employee_id, cutoff_id, work_date, time_in, time_out, hours_worked, overtime_hours, holiday_type, holiday_name, source, batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Biometrics', ?)
           ON DUPLICATE KEY UPDATE time_in=VALUES(time_in), time_out=VALUES(time_out), hours_worked=VALUES(hours_worked), overtime_hours=VALUES(overtime_hours), source='Biometrics', batch_id=VALUES(batch_id)`,
          [
            recordId, emp.id, cutoff_id || null, workDate,
            row.time_in || null, row.time_out || null,
            parseFloat(row.hours_worked) || 0,
            parseFloat(row.overtime_hours) || 0,
            holiday ? holiday.holiday_type : 'None',
            holiday ? holiday.holiday_name : null,
            batchId,
          ]
        );
        imported++;
      } catch (rowErr) {
        errors++;
        errorList.push(rowErr.message);
      }
    }

    await conn.query(
      'INSERT INTO payroll_biometrics_batches (id, batch_name, cutoff_id, row_count, imported_count, skipped_count, error_count, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [batchId, batch_name || `Biometrics Import ${new Date().toISOString().slice(0,10)}`, cutoff_id || null, rows.length, imported, skipped, errors, 'Imported', created_by || null]
    );

    await conn.commit();
    return res.json({ success: true, batch_id: batchId, imported, skipped, errors, error_list: errorList.slice(0, 20) });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/process_payroll', requireAuth, async (req, res) => {
  const { cutoff_id, processed_by, run_id: existingRunId } = req.body;
  if (!cutoff_id) return res.status(400).json({ error: 'cutoff_id required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cutoff]] = await conn.query('SELECT * FROM payroll_cutoffs WHERE id = ? LIMIT 1', [cutoff_id]);
    if (!cutoff) throw new Error('Cutoff not found');
    if (cutoff.status === 'Finalized') throw new Error('Cannot reprocess a finalized payroll');

    let runId = existingRunId;
    if (runId) {
      const [[run]] = await conn.query('SELECT * FROM payroll_runs WHERE id = ? LIMIT 1', [runId]);
      if (run && run.status === 'Finalized') throw new Error('Cannot reprocess a finalized payroll run');
      await conn.query('DELETE FROM payroll_run_item_lines WHERE run_id = ?', [runId]);
      await conn.query('DELETE FROM payroll_run_items WHERE run_id = ?', [runId]);
    } else {
      runId = uuidv4();
      const runNum = `PR-${cutoff.payroll_year}${String(cutoff.payroll_month).padStart(2,'0')}-${cutoff.cutoff_seq}`;
      await conn.query(
        'INSERT INTO payroll_runs (id, cutoff_id, run_number, status, processed_by, processed_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [runId, cutoff_id, runNum, 'Processing', processed_by || null]
      );
    }

    const [employees] = await conn.query('SELECT * FROM hr_employees WHERE is_active = 1 ORDER BY last_name');
    const [sssTable] = await conn.query('SELECT * FROM sss_table WHERE is_active = 1 ORDER BY range_from');
    const [[phTable]] = await conn.query('SELECT * FROM philhealth_table WHERE is_active = 1 LIMIT 1');
    const [[piTable]] = await conn.query('SELECT * FROM pagibig_table WHERE is_active = 1 LIMIT 1');

    const [holidays] = await conn.query(
      'SELECT * FROM payroll_holidays WHERE holiday_date BETWEEN ? AND ? AND is_active = 1',
      [cutoff.date_from, cutoff.date_to]
    );
    const holidayMap = {};
    for (const h of holidays) holidayMap[String(h.holiday_date).slice(0,10)] = h;

    const dateFrom = new Date(cutoff.date_from + 'T00:00:00');
    const dateTo = new Date(cutoff.date_to + 'T00:00:00');
    let totalWorkingDays = 0;
    for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) totalWorkingDays++;
    }

    let totalEmployees = 0, totalGross = 0, totalDeductions = 0, totalNet = 0;

    for (const emp of employees) {
      // Build attendance map: manual payroll_attendance takes priority;
      // fall back to summarised employee_time_logs (first TIME_IN / last TIME_OUT per day)
      const [attRows] = await conn.query(
        'SELECT * FROM payroll_attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ?',
        [emp.id, cutoff.date_from, cutoff.date_to]
      );
      const attMap = {};
      for (const a of attRows) attMap[String(a.work_date).slice(0,10)] = a;

      // Merge time-log summaries for dates without a manual attendance row
      const [logRows] = await conn.query(
        `SELECT log_date,
                MIN(CASE WHEN log_type='TIME_IN'  THEN log_time END) AS time_in,
                MAX(CASE WHEN log_type='TIME_OUT' THEN log_time END) AS time_out
         FROM employee_time_logs
         WHERE employee_id = ? AND log_date BETWEEN ? AND ?
         GROUP BY log_date`,
        [emp.id, cutoff.date_from, cutoff.date_to]
      );
      for (const lg of logRows) {
        const ds = String(lg.log_date).slice(0, 10);
        if (!attMap[ds] && (lg.time_in || lg.time_out)) {
          let hoursWorked = 0;
          if (lg.time_in && lg.time_out) {
            const [ih, im] = lg.time_in.split(':').map(Number);
            const [oh, om] = lg.time_out.split(':').map(Number);
            hoursWorked = Math.max(0, (oh * 60 + om - ih * 60 - im) / 60);
          }
          attMap[ds] = {
            work_date: ds, time_in: lg.time_in, time_out: lg.time_out,
            hours_worked: hoursWorked, late_minutes: 0, undertime_minutes: 0,
            overtime_hours: 0, is_absent: 0, is_rest_day: 0,
            holiday_type: 'None', source: 'time_log',
          };
        }
      }

      const basicMonthly = parseFloat(emp.basic_monthly_rate) || 0;
      let dailyRate = parseFloat(emp.daily_rate) || 0;
      if (!dailyRate && basicMonthly) dailyRate = basicMonthly / 26;
      const hourlyRate = parseFloat(emp.hourly_rate) || (dailyRate / 8);

      let daysWorked = 0, daysAbsent = 0, hoursLate = 0, hoursUndertime = 0, overtimeHours = 0;
      let holidayPay = 0, restDayPay = 0;

      for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0,10);
        const dayOfWeek = d.getDay();
        const att = attMap[ds];
        const holiday = holidayMap[ds];
        const isRestDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek] === emp.rest_day;

        if (dayOfWeek === 0 && emp.rest_day === 'Sunday' && !att) continue;

        if (att) {
          if (att.is_absent) {
            if (!isRestDay) daysAbsent += 1;
          } else {
            daysWorked += 1;
            hoursLate += parseFloat(att.late_minutes || 0) / 60;
            hoursUndertime += parseFloat(att.undertime_minutes || 0) / 60;
            if (att.overtime_eligible !== 0) overtimeHours += parseFloat(att.overtime_hours || 0);

            if (holiday) {
              if (holiday.holiday_type === 'Legal') {
                holidayPay += dailyRate * 1.0;
              } else if (holiday.holiday_type === 'Special') {
                holidayPay += dailyRate * 0.30;
              }
            }
            if (isRestDay && !holiday) restDayPay += dailyRate * 0.30;
          }
        } else {
          if (holiday && holiday.holiday_type === 'Legal' && !isRestDay) {
            daysWorked += 1;
          } else if (!isRestDay) {
            daysAbsent += 1;
          }
        }
      }

      let basicPay = 0;
      if (emp.payroll_type === 'Monthly') {
        basicPay = basicMonthly / 2;
        basicPay -= daysAbsent * dailyRate;
      } else {
        basicPay = daysWorked * dailyRate;
      }
      basicPay = Math.max(0, basicPay);

      const otPay = emp.overtime_eligible ? (overtimeHours * hourlyRate * 1.25) : 0;
      const lateDeduction = hoursLate * hourlyRate;
      const undertimeDeduction = hoursUndertime * hourlyRate;
      const allowances = parseFloat(emp.fixed_allowance) || 0;
      const grossPay = basicPay + otPay + holidayPay + restDayPay + allowances;

      let sssEmployee = 0;
      for (const bracket of sssTable) {
        if (basicMonthly >= bracket.range_from && basicMonthly <= bracket.range_to) {
          sssEmployee = parseFloat(bracket.employee_share) / 2;
          break;
        }
      }

      let phEmployee = 0;
      if (phTable) {
        const phRate = parseFloat(phTable.rate_percent) / 100;
        const phBase = Math.min(Math.max(basicMonthly, parseFloat(phTable.min_monthly_basic)), parseFloat(phTable.max_monthly_basic));
        const phTotal = phBase * phRate;
        phEmployee = (phTotal * (parseFloat(phTable.employee_share_percent) / 100)) / 2;
        phEmployee = Math.min(Math.max(phEmployee, parseFloat(phTable.min_contribution) / 2), parseFloat(phTable.max_contribution) / 2);
      }

      let piEmployee = 0;
      if (piTable) {
        const piRate = parseFloat(piTable.employee_rate_percent) / 100;
        piEmployee = Math.min(basicMonthly * piRate, parseFloat(piTable.max_employee_contribution));
        piEmployee = piEmployee / 2;
      }

      let caDeduction = 0;
      const [caRows] = await conn.query(
        'SELECT id, deduction_per_cutoff, deduction_mode, balance FROM payroll_cash_advances WHERE employee_id = ? AND status = ? AND balance > 0',
        [emp.id, 'Active']
      );
      for (const ca of caRows) {
        const mode = ca.deduction_mode || 'every_cutoff';
        if (mode === 'manual') continue;
        if (mode === 'every_other' && cutoff.cutoff_seq !== 1) continue;
        if (mode === 'every_other_2nd' && cutoff.cutoff_seq !== 2) continue;
        const ded = Math.min(parseFloat(ca.deduction_per_cutoff) || 0, parseFloat(ca.balance));
        caDeduction += ded;
        if (ded > 0) {
          const newBalance = Math.max(0, parseFloat(ca.balance) - ded);
          await conn.query('UPDATE payroll_cash_advances SET balance = ?, status = ? WHERE id = ?',
            [newBalance, newBalance === 0 ? 'Settled' : 'Active', ca.id]);
        }
      }

      const totalDed = sssEmployee + phEmployee + piEmployee + caDeduction + lateDeduction + undertimeDeduction;
      const netPay = Math.max(0, grossPay - totalDed);

      const itemId = uuidv4();
      const deptName = emp.department_id ? (await conn.query('SELECT name FROM hr_departments WHERE id = ? LIMIT 1', [emp.department_id]))[0][0]?.name || '' : '';
      const posName = emp.position_id ? (await conn.query('SELECT name FROM hr_positions WHERE id = ? LIMIT 1', [emp.position_id]))[0][0]?.name || '' : '';

      await conn.query(`
        INSERT INTO payroll_run_items (id, run_id, cutoff_id, employee_id, employee_code, employee_name, department, position,
          payroll_type, basic_monthly_rate, daily_rate, days_in_period, days_worked, days_absent, hours_late, hours_undertime,
          overtime_hours, basic_pay, overtime_pay, holiday_pay, allowances, gross_pay, sss_deduction, philhealth_deduction,
          pagibig_deduction, cash_advance_deduction, other_deductions, total_deductions, net_pay)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        itemId, runId, cutoff_id, emp.id, emp.employee_code,
        `${emp.last_name}, ${emp.first_name}`,
        deptName, posName, emp.payroll_type, basicMonthly, dailyRate,
        totalWorkingDays, daysWorked, daysAbsent,
        Math.round(hoursLate * 100) / 100, Math.round(hoursUndertime * 100) / 100,
        overtimeHours,
        Math.round(basicPay * 100) / 100, Math.round(otPay * 100) / 100,
        Math.round((holidayPay + restDayPay) * 100) / 100, allowances,
        Math.round(grossPay * 100) / 100,
        Math.round(sssEmployee * 100) / 100, Math.round(phEmployee * 100) / 100, Math.round(piEmployee * 100) / 100,
        Math.round(caDeduction * 100) / 100,
        Math.round((lateDeduction + undertimeDeduction) * 100) / 100,
        Math.round(totalDed * 100) / 100, Math.round(netPay * 100) / 100,
      ]);

      const itemLines = [
        { type: 'Earning', code: 'BASIC', name: 'Basic Pay', amount: basicPay, sort: 1 },
        { type: 'Earning', code: 'OT', name: 'Overtime Pay', amount: otPay, sort: 2 },
        { type: 'Earning', code: 'HOLIDAY', name: 'Holiday Pay', amount: holidayPay + restDayPay, sort: 3 },
        { type: 'Earning', code: 'ALLOWANCE', name: 'Allowances', amount: allowances, sort: 4 },
        { type: 'Deduction', code: 'ABSENT', name: 'Absent Deduction', amount: daysAbsent * dailyRate, sort: 10 },
        { type: 'Deduction', code: 'LATE', name: 'Late/Tardiness', amount: lateDeduction, sort: 11 },
        { type: 'Deduction', code: 'UNDERTIME', name: 'Undertime', amount: undertimeDeduction, sort: 12 },
        { type: 'Deduction', code: 'SSS', name: 'SSS Contribution', amount: sssEmployee, sort: 20 },
        { type: 'Deduction', code: 'PHILHEALTH', name: 'PhilHealth Contribution', amount: phEmployee, sort: 21 },
        { type: 'Deduction', code: 'PAGIBIG', name: 'Pag-IBIG Contribution', amount: piEmployee, sort: 22 },
        { type: 'Deduction', code: 'CA', name: 'Cash Advance', amount: caDeduction, sort: 23 },
      ];
      for (const l of itemLines) {
        if (l.amount !== 0) {
          await conn.query(
            'INSERT INTO payroll_run_item_lines (id, run_item_id, run_id, line_type, code, name, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [uuidv4(), itemId, runId, l.type, l.code, l.name, Math.round(l.amount * 100) / 100, l.sort]
          );
        }
      }

      totalEmployees++;
      totalGross += grossPay;
      totalDeductions += totalDed;
      totalNet += netPay;
    }

    await conn.query(
      'UPDATE payroll_runs SET status=?, total_employees=?, total_gross=?, total_deductions=?, total_net=?, processed_at=NOW(), processed_by=? WHERE id=?',
      ['Draft', totalEmployees, Math.round(totalGross*100)/100, Math.round(totalDeductions*100)/100, Math.round(totalNet*100)/100, processed_by || null, runId]
    );

    await conn.commit();
    return res.json({ success: true, run_id: runId, total_employees: totalEmployees, total_gross: totalGross, total_net: totalNet });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/finalize_payroll', requireAuth, async (req, res) => {
  const { run_id, finalized_by } = req.body;
  if (!run_id) return res.status(400).json({ error: 'run_id required' });
  try {
    const [[run]] = await pool.query('SELECT * FROM payroll_runs WHERE id = ? LIMIT 1', [run_id]);
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status === 'Finalized') return res.status(400).json({ error: 'Already finalized' });
    await pool.query('UPDATE payroll_runs SET status=?, finalized_by=?, finalized_at=NOW() WHERE id=?', ['Finalized', finalized_by || null, run_id]);
    await pool.query('UPDATE payroll_cutoffs SET status=? WHERE id=?', ['Finalized', run.cutoff_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_payroll_run', requireAuth, async (req, res) => {
  const { run_id, cutoff_id } = req.body;
  try {
    let run;
    if (run_id) {
      [[run]] = await pool.query('SELECT pr.*, pc.period_name, pc.date_from, pc.date_to FROM payroll_runs pr LEFT JOIN payroll_cutoffs pc ON pc.id = pr.cutoff_id WHERE pr.id = ? LIMIT 1', [run_id]);
    } else if (cutoff_id) {
      [[run]] = await pool.query('SELECT pr.*, pc.period_name, pc.date_from, pc.date_to FROM payroll_runs pr LEFT JOIN payroll_cutoffs pc ON pc.id = pr.cutoff_id WHERE pr.cutoff_id = ? ORDER BY pr.created_at DESC LIMIT 1', [cutoff_id]);
    }
    if (!run) return res.json({ run: null, items: [] });
    const [items] = await pool.query('SELECT * FROM payroll_run_items WHERE run_id = ? ORDER BY employee_name', [run.id]);
    const [lines] = await pool.query('SELECT * FROM payroll_run_item_lines WHERE run_id = ? ORDER BY sort_order', [run.id]);
    const linesMap = {};
    for (const l of lines) {
      if (!linesMap[l.run_item_id]) linesMap[l.run_item_id] = [];
      linesMap[l.run_item_id].push(l);
    }
    for (const item of items) item.lines = linesMap[item.id] || [];
    return res.json({ run, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_payslip', requireAuth, async (req, res) => {
  const { run_item_id } = req.body;
  if (!run_item_id) return res.status(400).json({ error: 'run_item_id required' });
  try {
    const [[item]] = await pool.query(
      `SELECT ri.*, pr.run_number, pr.status as run_status, pr.finalized_at,
              pc.period_name, pc.date_from, pc.date_to, pc.payroll_month, pc.payroll_year,
              e.sss_number, e.philhealth_number, e.pagibig_number, e.tin
       FROM payroll_run_items ri
       LEFT JOIN payroll_runs pr ON pr.id = ri.run_id
       LEFT JOIN payroll_cutoffs pc ON pc.id = ri.cutoff_id
       LEFT JOIN hr_employees e ON e.id = ri.employee_id
       WHERE ri.id = ? LIMIT 1`,
      [run_item_id]
    );
    if (!item) return res.status(404).json({ error: 'Payslip not found' });
    const [lines] = await pool.query('SELECT * FROM payroll_run_item_lines WHERE run_item_id = ? ORDER BY sort_order', [run_item_id]);
    return res.json({ payslip: item, lines });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/search_cash_advances', requireAuth, async (req, res) => {
  const { employee_id = '', status = '', page = 1, page_size = 50 } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (employee_id) { where += ' AND ca.employee_id = ?'; params.push(employee_id); }
    if (status) { where += ' AND ca.status = ?'; params.push(status); }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM payroll_cash_advances ca WHERE ${where}`, params);
    const offset = (page - 1) * page_size;
    const [rows] = await pool.query(
      `SELECT ca.*, CONCAT(e.last_name, ', ', e.first_name) as employee_name, e.employee_code
       FROM payroll_cash_advances ca
       LEFT JOIN hr_employees e ON e.id = ca.employee_id
       WHERE ${where}
       ORDER BY ca.date_granted DESC
       LIMIT ? OFFSET ?`,
      [...params, page_size, offset]
    );
    return res.json({ advances: rows, total, page, page_size });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/save_cash_advance', requireAuth, async (req, res) => {
  const { advance, created_by } = req.body;
  if (!advance || !advance.employee_id || !advance.amount) return res.status(400).json({ error: 'employee_id and amount required' });
  try {
    const isNew = !advance.id;
    const id = advance.id || uuidv4();
    const amount = parseFloat(advance.amount) || 0;
    const deductionMode = advance.deduction_mode || 'every_cutoff';
    if (isNew) {
      await pool.query(
        'INSERT INTO payroll_cash_advances (id, employee_id, date_granted, amount, balance, deduction_per_cutoff, deduction_mode, status, remarks, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, advance.employee_id, advance.date_granted || new Date().toISOString().slice(0,10), amount, amount, parseFloat(advance.deduction_per_cutoff) || 0, deductionMode, advance.status || 'Active', advance.remarks || null, created_by || null]
      );
    } else {
      await pool.query(
        'UPDATE payroll_cash_advances SET date_granted=?, deduction_per_cutoff=?, deduction_mode=?, status=?, remarks=?, balance=? WHERE id=?',
        [advance.date_granted, parseFloat(advance.deduction_per_cutoff) || 0, deductionMode, advance.status || 'Active', advance.remarks || null, parseFloat(advance.balance) || 0, id]
      );
    }
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/search_holidays', requireAuth, async (req, res) => {
  const { year, search = '', page = 1, page_size = 50 } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (year) { where += ' AND year = ?'; params.push(year); }
    if (search) { where += ' AND holiday_name LIKE ?'; params.push(`%${search}%`); }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM payroll_holidays WHERE ${where}`, params);
    const offset = (page - 1) * page_size;
    const [rows] = await pool.query(
      `SELECT * FROM payroll_holidays WHERE ${where} ORDER BY holiday_date ASC LIMIT ? OFFSET ?`,
      [...params, page_size, offset]
    );
    return res.json({ holidays: rows, total, page, page_size });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/save_holiday', requireAuth, async (req, res) => {
  const { holiday } = req.body;
  if (!holiday || !holiday.holiday_name || !holiday.holiday_date) return res.status(400).json({ error: 'holiday_name and holiday_date required' });
  try {
    const isNew = !holiday.id;
    const id = holiday.id || uuidv4();
    if (isNew) {
      await pool.query(
        'INSERT INTO payroll_holidays (id, holiday_name, holiday_date, holiday_type, is_recurring, year, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, holiday.holiday_name, holiday.holiday_date, holiday.holiday_type || 'Legal', holiday.is_recurring ? 1 : 0, holiday.year || new Date(holiday.holiday_date).getFullYear(), holiday.is_active != null ? (holiday.is_active ? 1 : 0) : 1]
      );
    } else {
      await pool.query(
        'UPDATE payroll_holidays SET holiday_name=?, holiday_date=?, holiday_type=?, is_recurring=?, year=?, is_active=? WHERE id=?',
        [holiday.holiday_name, holiday.holiday_date, holiday.holiday_type || 'Legal', holiday.is_recurring ? 1 : 0, holiday.year || new Date(holiday.holiday_date).getFullYear(), holiday.is_active != null ? (holiday.is_active ? 1 : 0) : 1, id]
      );
    }
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_payroll_register_report', requireAuth, async (req, res) => {
  const { cutoff_id, run_id } = req.body;
  try {
    let targetRunId = run_id;
    if (!targetRunId && cutoff_id) {
      const [[run]] = await pool.query('SELECT id FROM payroll_runs WHERE cutoff_id = ? ORDER BY created_at DESC LIMIT 1', [cutoff_id]);
      targetRunId = run?.id;
    }
    if (!targetRunId) return res.json({ run: null, items: [] });
    const [[run]] = await pool.query(
      'SELECT pr.*, pc.period_name, pc.date_from, pc.date_to FROM payroll_runs pr LEFT JOIN payroll_cutoffs pc ON pc.id = pr.cutoff_id WHERE pr.id = ?',
      [targetRunId]
    );
    const [items] = await pool.query('SELECT * FROM payroll_run_items WHERE run_id = ? ORDER BY employee_name', [targetRunId]);
    return res.json({ run, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_contributions_report', requireAuth, async (req, res) => {
  const { cutoff_id } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (cutoff_id) { where += ' AND ri.cutoff_id = ?'; params.push(cutoff_id); }
    const [rows] = await pool.query(
      `SELECT ri.employee_code, ri.employee_name, ri.department,
              ri.basic_monthly_rate, ri.gross_pay,
              ri.sss_deduction, ri.philhealth_deduction, ri.pagibig_deduction,
              (ri.sss_deduction + ri.philhealth_deduction + ri.pagibig_deduction) as total_statutory
       FROM payroll_run_items ri
       LEFT JOIN payroll_runs pr ON pr.id = ri.run_id
       WHERE ${where}
       ORDER BY ri.employee_name`,
      params
    );
    return res.json({ items: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/get_attendance_report', requireAuth, async (req, res) => {
  const { cutoff_id = '', employee_id = '', date_from = '', date_to = '' } = req.body;
  try {
    let where = '1=1';
    const params = [];
    if (cutoff_id) { where += ' AND a.cutoff_id = ?'; params.push(cutoff_id); }
    if (employee_id) { where += ' AND a.employee_id = ?'; params.push(employee_id); }
    if (date_from) { where += ' AND a.work_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND a.work_date <= ?'; params.push(date_to); }
    const [rows] = await pool.query(
      `SELECT a.*, CONCAT(e.last_name, ', ', e.first_name) as employee_name, e.employee_code, d.name as department
       FROM payroll_attendance a
       LEFT JOIN hr_employees e ON e.id = a.employee_id
       LEFT JOIN hr_departments d ON d.id = e.department_id
       WHERE ${where}
       ORDER BY e.last_name, a.work_date`,
      params
    );
    return res.json({ attendance: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/generate_dtr_for_cutoff ─────────────────────────────
router.post('/generate_dtr_for_cutoff', requireAuth, async (req, res) => {
  const { cutoff_id } = req.body;
  if (!cutoff_id) return res.status(400).json({ error: 'cutoff_id required' });
  try {
    const [[cutoff]] = await pool.query('SELECT * FROM payroll_cutoffs WHERE id = ? LIMIT 1', [cutoff_id]);
    if (!cutoff) return res.status(404).json({ error: 'Cutoff not found' });

    const [employees] = await pool.query('SELECT id, rest_day FROM hr_employees WHERE is_active = 1');
    if (!employees.length) return res.json({ success: true, created: 0, skipped: 0 });

    const DEFAULT_TIME_IN = '09:00:00';
    const DEFAULT_TIME_OUT = '18:00:00';
    const DEFAULT_HOURS = 9;
    const dayIndex = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

    // Load holidays for the cutoff range
    const [holidayRows] = await pool.query(
      'SELECT holiday_date, holiday_type, holiday_name FROM payroll_holidays WHERE holiday_date BETWEEN ? AND ? AND is_active = 1',
      [cutoff.date_from, cutoff.date_to]
    );
    const holidayMap = new Map();
    for (const h of holidayRows) {
      const key = h.holiday_date instanceof Date ? h.holiday_date.toISOString().slice(0, 10) : String(h.holiday_date).slice(0, 10);
      holidayMap.set(key, { type: h.holiday_type, name: h.holiday_name });
    }

    let created = 0;
    let skipped = 0;

    for (const emp of employees) {
      const restDay = emp.rest_day || 'Sunday';
      const restDayNum = dayIndex[restDay] ?? 0;

      const d = new Date(cutoff.date_from + 'T00:00:00');
      const toDate = new Date(cutoff.date_to + 'T00:00:00');

      while (d <= toDate) {
        const dow = d.getDay();
        const workDate = d.toISOString().slice(0, 10);
        d.setDate(d.getDate() + 1);
        if (dow === restDayNum) continue;

        const holiday = holidayMap.get(workDate);
        const holidayType = holiday ? holiday.type : 'None';
        const holidayName = holiday ? holiday.name : null;

        const id = uuidv4();
        try {
          await pool.query(
            `INSERT IGNORE INTO payroll_attendance
               (id, employee_id, cutoff_id, work_date, time_in, time_out, hours_worked,
                late_minutes, undertime_minutes, overtime_hours, is_absent, is_rest_day,
                holiday_type, holiday_name, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, 'generated')`,
            [id, emp.id, cutoff_id, workDate, DEFAULT_TIME_IN, DEFAULT_TIME_OUT, DEFAULT_HOURS, holidayType, holidayName]
          );
          created++;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') { skipped++; } else { throw e; }
        }
      }
    }
    return res.json({ success: true, created, skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/record_payroll_disbursement ─────────────────────────
router.post('/record_payroll_disbursement', requireAuth, async (req, res) => {
  const { run_id, amount, payment_source, account_id, date, description, notes, created_by } = req.body;
  if (!run_id) return res.status(400).json({ error: 'run_id required' });
  if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Valid amount required' });
  if (!payment_source) return res.status(400).json({ error: 'payment_source required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const disbId = uuidv4();
    const txDate = date || new Date().toISOString().slice(0, 10);
    const txAmount = parseFloat(amount);
    const txDesc = description || 'Payroll Disbursement';
    const txNotes = notes || null;

    if (payment_source === 'gcash') {
      if (!account_id) throw new Error('account_id required for GCash disbursement');
      const txId = uuidv4();
      await conn.query(
        `INSERT INTO transactions
           (id, account_id, transaction_type, transaction_category, amount, transaction_fee,
            date, description, source, source_module, source_reference_id, disbursement_id, created_by)
         VALUES (?, ?, 'cash_out', 'regular', ?, 0, ?, ?, 'gcash', 'payroll', ?, ?, ?)`,
        [txId, account_id, txAmount, txDate, txDesc, run_id, disbId, created_by || null]
      );
      await conn.query(
        `INSERT INTO disbursements
           (id, date, payee, purpose, amount, payment_method, disbursement_type,
            source_module, source_reference_id, source_account_type, source_account_id, notes, created_by)
         VALUES (?, ?, 'Payroll Payout', ?, ?, 'gcash', 'payroll_payout', 'payroll', ?, 'gcash', ?, ?, ?)`,
        [disbId, txDate, txDesc, txAmount, run_id, account_id, txNotes, created_by || null]
      );
    } else {
      const txId = uuidv4();
      const cashOutType = payment_source === 'pos_cash' ? 'pos_cash' : 'cash_fund_payroll';
      await conn.query(
        `INSERT INTO cash_transactions
           (id, transaction_type, transaction_category, amount, date, description, cash_out_type,
            source_module, source_reference_id, disbursement_id, created_by)
         VALUES (?, 'cash_fund_disbursement', 'regular', ?, ?, ?, ?, 'payroll', ?, ?, ?)`,
        [txId, txAmount, txDate, txDesc, cashOutType, run_id, disbId, created_by || null]
      );
      await conn.query(
        `INSERT INTO disbursements
           (id, date, payee, purpose, amount, payment_method, disbursement_type,
            source_module, source_reference_id, source_account_type, notes, created_by)
         VALUES (?, ?, 'Payroll Payout', ?, ?, 'cash', 'payroll_payout', 'payroll', ?, ?, ?, ?)`,
        [disbId, txDate, txDesc, txAmount, run_id, payment_source, txNotes, created_by || null]
      );
    }
    await conn.commit();
    return res.json({ success: true, disbursement_id: disbId });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

async function getEmployeeClockStatus(employeeId, logDate) {
  const [logs] = await pool.query(
    `SELECT log_type, log_time
       FROM employee_time_logs
      WHERE employee_id = ? AND log_date = ?
      ORDER BY log_time ASC`,
    [employeeId, logDate]
  );

  const firstTimeIn = logs.find((row) => row.log_type === 'TIME_IN')?.log_time ?? null;
  const lastTimeOut = [...logs].reverse().find((row) => row.log_type === 'TIME_OUT')?.log_time ?? null;
  const hasTimeIn = Boolean(firstTimeIn);
  const hasTimeOut = Boolean(lastTimeOut);
  const canTimeIn = !hasTimeIn;
  const canTimeOut = hasTimeIn && !hasTimeOut;

  let message = 'Ready for Time In';
  if (canTimeOut) {
    message = 'Already timed in today — only Time Out is enabled';
  } else if (hasTimeIn && hasTimeOut) {
    message = 'Attendance already completed for today';
  }

  return {
    has_time_in: hasTimeIn,
    has_time_out: hasTimeOut,
    first_time_in: firstTimeIn,
    last_time_out: lastTimeOut,
    can_time_in: canTimeIn,
    can_time_out: canTimeOut,
    next_action: canTimeIn ? 'TIME_IN' : canTimeOut ? 'TIME_OUT' : null,
    message,
  };
}

// ── POST /rpc/employee_clock ─────────────────────────────────────
// Public endpoint — no requireAuth — used on the shared time-clock screen
router.post('/employee_clock', async (req, res) => {
  const { employee_code, log_type, device_name } = req.body;
  if (!employee_code) return res.status(400).json({ error: 'employee_code required' });
  if (!log_type || !['TIME_IN', 'TIME_OUT'].includes(log_type))
    return res.status(400).json({ error: 'log_type must be TIME_IN or TIME_OUT' });

  try {
    const [[emp]] = await pool.query(
      'SELECT id, first_name, last_name, is_active FROM hr_employees WHERE employee_code = ? LIMIT 1',
      [employee_code.trim().toUpperCase()]
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    if (!emp.is_active) return res.status(403).json({ error: 'Employee is inactive' });

    const now = new Date();
    const logDate = now.toISOString().slice(0, 10);
    const logTime = now.toTimeString().slice(0, 8); // HH:MM:SS
    const status = await getEmployeeClockStatus(emp.id, logDate);

    if (log_type === 'TIME_IN' && !status.can_time_in) {
      return res.status(400).json({
        error: status.can_time_out
          ? 'Already timed in today. Only Time Out is enabled.'
          : 'This employee already completed Time In and Time Out for today.',
      });
    }

    if (log_type === 'TIME_OUT' && !status.can_time_out) {
      return res.status(400).json({
        error: status.has_time_out
          ? 'This employee is already timed out for today.'
          : 'This employee must time in first before timing out.',
      });
    }

    const id = uuidv4();
    await pool.query(
      'INSERT INTO employee_time_logs (id, employee_id, log_date, log_time, log_type, device_name) VALUES (?, ?, ?, ?, ?, ?)',
      [id, emp.id, logDate, logTime, log_type, device_name || null]
    );

    return res.json({
      success: true,
      log_id: id,
      employee_name: `${emp.first_name} ${emp.last_name}`,
      log_date: logDate,
      log_time: logTime,
      log_type,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/get_employee_by_code ───────────────────────────────
// Public — used to preview employee name before clocking
router.post('/get_employee_by_code', async (req, res) => {
  const { employee_code } = req.body;
  if (!employee_code) return res.status(400).json({ error: 'employee_code required' });
  try {
    const [[emp]] = await pool.query(
      'SELECT id, employee_code, first_name, last_name, is_active FROM hr_employees WHERE employee_code = ? LIMIT 1',
      [employee_code.trim().toUpperCase()]
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const logDate = new Date().toISOString().slice(0, 10);
    const clock_status = await getEmployeeClockStatus(emp.id, logDate);
    return res.json({ employee: emp, clock_status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/search_time_logs ────────────────────────────────────
router.post('/search_time_logs', requireAuth, async (req, res) => {
  const { date_from = '', date_to = '', employee_id = '', cutoff_id = '' } = req.body;
  try {
    let dateFrom = date_from;
    let dateTo = date_to;

    // If cutoff_id provided, derive date range from cutoff
    if (cutoff_id && (!dateFrom || !dateTo)) {
      const [[cutoff]] = await pool.query('SELECT date_from, date_to FROM payroll_cutoffs WHERE id = ? LIMIT 1', [cutoff_id]);
      if (cutoff) { dateFrom = cutoff.date_from; dateTo = cutoff.date_to; }
    }

    let where = '1=1';
    const params = [];
    if (dateFrom) { where += ' AND l.log_date >= ?'; params.push(dateFrom); }
    if (dateTo)   { where += ' AND l.log_date <= ?'; params.push(dateTo); }
    if (employee_id) { where += ' AND l.employee_id = ?'; params.push(employee_id); }

    // Return raw logs grouped per employee per date with first TIME_IN and last TIME_OUT
    const [rows] = await pool.query(
      `SELECT
         l.log_date,
         l.employee_id,
         CONCAT(e.last_name, ', ', e.first_name) AS employee_name,
         e.employee_code,
         MAX(CASE WHEN l.log_type = 'TIME_IN'  THEN l.log_time END) AS first_time_in,
         MAX(CASE WHEN l.log_type = 'TIME_OUT' THEN l.log_time END) AS last_time_out,
         COUNT(*) AS log_count
       FROM employee_time_logs l
       LEFT JOIN hr_employees e ON e.id = l.employee_id
       WHERE ${where}
       GROUP BY l.log_date, l.employee_id
       ORDER BY l.log_date ASC, e.last_name ASC`,
      params
    );

    // Also return raw individual log events for drill-down
    const [rawLogs] = await pool.query(
      `SELECT l.*, CONCAT(e.last_name, ', ', e.first_name) AS employee_name, e.employee_code
       FROM employee_time_logs l
       LEFT JOIN hr_employees e ON e.id = l.employee_id
       WHERE ${where}
       ORDER BY l.log_date ASC, l.log_time ASC`,
      params
    );

    return res.json({ daily_summary: rows, raw_logs: rawLogs, date_from: dateFrom, date_to: dateTo });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/save_time_log ───────────────────────────────────────
router.post('/save_time_log', requireAuth, async (req, res) => {
  const { log } = req.body;
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!log?.id) return res.status(400).json({ error: 'log.id required' });

  const logDate = String(log.log_date || '').slice(0, 10);
  const logTime = String(log.log_time || '').slice(0, 8);
  const logType = String(log.log_type || '').toUpperCase() === 'TIME_OUT' ? 'TIME_OUT' : 'TIME_IN';
  const deviceName = String(log.device_name || '').trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    return res.status(400).json({ error: 'Valid log_date required' });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(logTime)) {
    return res.status(400).json({ error: 'Valid log_time required' });
  }

  try {
    const [[existing]] = await pool.query('SELECT id FROM employee_time_logs WHERE id = ? LIMIT 1', [log.id]);
    if (!existing) return res.status(404).json({ error: 'Time log not found' });

    await pool.query(
      'UPDATE employee_time_logs SET log_date = ?, log_time = ?, log_type = ?, device_name = ? WHERE id = ?',
      [logDate, logTime, logType, deviceName, log.id]
    );

    return res.json({ success: true, id: log.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_time_log ─────────────────────────────────────
router.post('/delete_time_log', requireAuth, async (req, res) => {
  const { log_id } = req.body;
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!log_id) return res.status(400).json({ error: 'log_id required' });
  try {
    await pool.query('DELETE FROM employee_time_logs WHERE id = ?', [log_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_attendance ───────────────────────────────────
router.post('/delete_attendance', requireAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    await pool.query('DELETE FROM payroll_attendance WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_payroll_cutoff ───────────────────────────────
router.post('/delete_payroll_cutoff', requireAuth, async (req, res) => {
  const { cutoff_id } = req.body;
  if (!cutoff_id) return res.status(400).json({ error: 'cutoff_id required' });
  try {
    const [[cutoff]] = await pool.query('SELECT status FROM payroll_cutoffs WHERE id = ? LIMIT 1', [cutoff_id]);
    if (!cutoff) return res.status(404).json({ error: 'Cutoff not found' });
    if (cutoff.status === 'Finalized') return res.status(400).json({ error: 'Cannot delete a finalized cutoff' });
    const [[{ runs }]] = await pool.query('SELECT COUNT(*) as runs FROM payroll_runs WHERE cutoff_id = ?', [cutoff_id]);
    if (runs > 0) return res.status(400).json({ error: 'Cannot delete: payroll has been processed for this cutoff' });
    await pool.query('DELETE FROM payroll_cutoffs WHERE id = ?', [cutoff_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_cash_advance ─────────────────────────────────
router.post('/delete_cash_advance', requireAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const [[ca]] = await pool.query('SELECT status, balance, amount FROM payroll_cash_advances WHERE id = ? LIMIT 1', [id]);
    if (!ca) return res.status(404).json({ error: 'Record not found' });
    await pool.query('DELETE FROM payroll_cash_advances WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_holiday ──────────────────────────────────────
router.post('/delete_holiday', requireAuth, async (req, res) => {
  const { holiday_id } = req.body;
  if (!holiday_id) return res.status(400).json({ error: 'holiday_id required' });
  try {
    await pool.query('DELETE FROM payroll_holidays WHERE id = ?', [holiday_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_department ───────────────────────────────────
router.post('/delete_department', requireAuth, async (req, res) => {
  const { department_id } = req.body;
  if (!department_id) return res.status(400).json({ error: 'department_id required' });
  try {
    const [[{ empCount }]] = await pool.query('SELECT COUNT(*) as empCount FROM hr_employees WHERE department_id = ?', [department_id]);
    if (empCount > 0) return res.status(400).json({ error: 'Cannot delete: department has assigned employees' });
    await pool.query('DELETE FROM hr_departments WHERE id = ?', [department_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/delete_position ─────────────────────────────────────
router.post('/delete_position', requireAuth, async (req, res) => {
  const { position_id } = req.body;
  if (!position_id) return res.status(400).json({ error: 'position_id required' });
  try {
    const [[{ empCount }]] = await pool.query('SELECT COUNT(*) as empCount FROM hr_employees WHERE position_id = ?', [position_id]);
    if (empCount > 0) return res.status(400).json({ error: 'Cannot delete: position has assigned employees' });
    await pool.query('DELETE FROM hr_positions WHERE id = ?', [position_id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Cash drawer kick via ESC/POS raw print ────────────────────────────────
router.post('/open_cash_drawer', requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const printerName = String(payload.printer_name ?? 'XPrinter 58IIH').trim();
  if (!printerName) return res.status(400).json({ error: 'printer_name is required' });

  // ESC p 0 25 250 — standard cash drawer kick (pin 2, 50ms on, 500ms off)
  const ps = `
$ErrorActionPreference = 'Stop'
$printerName = '${printerName.replace(/'/g, "''")}'
$drawer = [byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDatatype;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
"@
$h = [IntPtr]::Zero
if (-not [RawPrinterHelper]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) {
    throw "Cannot open printer: $printerName"
}
try {
    $di = New-Object RawPrinterHelper+DOCINFOA
    $di.pDocName = "CashDrawer"
    $di.pOutputFile = $null
    $di.pDatatype = "RAW"
    [RawPrinterHelper]::StartDocPrinter($h, 1, $di) | Out-Null
    [RawPrinterHelper]::StartPagePrinter($h) | Out-Null
    $gch = [Runtime.InteropServices.GCHandle]::Alloc($drawer, [Runtime.InteropServices.GCHandleType]::Pinned)
    try {
        $written = 0
        [RawPrinterHelper]::WritePrinter($h, $gch.AddrOfPinnedObject(), $drawer.Length, [ref]$written) | Out-Null
    } finally { $gch.Free() }
    [RawPrinterHelper]::EndPagePrinter($h) | Out-Null
    [RawPrinterHelper]::EndDocPrinter($h) | Out-Null
} finally {
    [RawPrinterHelper]::ClosePrinter($h) | Out-Null
}
Write-Output "OK"
`.trim();

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code !== 0) reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        else resolve(null);
      });
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /rpc/import_historical_records ──────────────────────────
// Bulk import of old checks and expenses for P&L reporting only.
// Records are inserted with affects_cashflow=false so they never
// disturb running balances or outstanding check counts.
// Checks are inserted as 'cleared' + a matching disbursement.
// Expenses are inserted as disbursements only.
router.post('/import_historical_records', requireAuth, async (req, res) => {
  const { type, rows } = req.body;
  const userId = req.user?.id ?? null;

  if (!['checks', 'expenses'].includes(type)) {
    return res.status(400).json({ error: "type must be 'checks' or 'expenses'" });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }
  if (rows.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 rows per import' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      try {
        const date = String(row.date ?? '').trim();
        const amount = parseFloat(String(row.amount ?? '0').replace(/,/g, ''));
        const payee = String(row.payee ?? row.supplier_name ?? '').trim() || 'Unknown';
        const description = String(row.description ?? row.purpose ?? '').trim();

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push(`Row ${rowNum}: invalid or missing date (expected YYYY-MM-DD)`);
          continue;
        }
        if (isNaN(amount) || amount <= 0) {
          errors.push(`Row ${rowNum}: invalid or missing amount`);
          continue;
        }

        const disbId = uuidv4();
        const now = new Date().toISOString();

        if (type === 'checks') {
          const checkNumber = String(row.check_number ?? '').trim();
          const checkDate = String(row.check_date ?? date).trim();

          if (!checkNumber) {
            errors.push(`Row ${rowNum}: check_number is required`);
            continue;
          }

          // Insert into checks_issued as cleared (historical, no cashflow)
          const checkId = uuidv4();
          await conn.query(
            `INSERT INTO checks_issued
               (id, check_number, bank_account_id, supplier_id, issued_date, check_date,
                cleared_date, amount, payee, description, notes, status,
                manually_set_status, disbursement_id, is_deleted, created_by, created_at, updated_at)
             VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'cleared', 1, ?, 0, ?, ?, ?)`,
            [checkId, checkNumber, date, checkDate, date, amount,
             payee, description, 'Historical import', disbId, userId, now, now]
          );

          // Matching disbursement — affects_cashflow=false
          await conn.query(
            `INSERT INTO disbursements
               (id, date, payee, purpose, amount, payment_method, disbursement_type,
                check_id, check_number, affects_cashflow, is_deleted,
                description, notes, source_module, source_reference_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'check', 'historical_import',
                     ?, ?, 0, 0, ?, 'Historical check import', 'historical_import', ?, ?, ?, ?)`,
            [disbId, date, payee, description || 'Historical check', amount,
             checkId, checkNumber, description, checkId, userId, now, now]
          );
        } else {
          // Expense only — disbursement with affects_cashflow=false
          await conn.query(
            `INSERT INTO disbursements
               (id, date, payee, purpose, amount, payment_method, disbursement_type,
                affects_cashflow, is_deleted,
                description, notes, source_module, source_reference_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'cash', 'historical_import',
                     0, 0, ?, 'Historical expense import', 'historical_import', ?, ?, ?, ?)`,
            [disbId, date, payee, description || 'Historical expense', amount,
             description, disbId, userId, now, now]
          );
        }

        imported++;
      } catch (rowErr) {
        errors.push(`Row ${rowNum}: ${rowErr.message}`);
      }
    }

    if (imported === 0 && errors.length > 0) {
      await conn.rollback();
      return res.status(422).json({ success: false, imported: 0, errors });
    }

    await conn.commit();
    return res.json({ success: true, imported, errors });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

export default router;

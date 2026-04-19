function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 1000000) / 1000000;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

export function normalizePriceLevel(value) {
  if (value === 'Wholesale' || value === 'Special') return value;
  return 'Retail';
}

export function computeBaseQuantity(qty, qtyInBaseUnitPerUnit) {
  return roundQty(toNumber(qty) * (toNumber(qtyInBaseUnitPerUnit) || 1));
}

export function computeCostPerBase(unitCost, qtyInBaseUnitPerUnit) {
  const divisor = toNumber(qtyInBaseUnitPerUnit) || 1;
  return roundMoney(toNumber(unitCost) / divisor);
}

function formatBaseQtyLabel(value, baseUnitName) {
  const qty = toNumber(value);
  const normalized = Number.isInteger(qty) ? String(qty) : qty.toFixed(6).replace(/\.?0+$/, '');
  return baseUnitName ? `${normalized} ${baseUnitName}` : normalized;
}

export function computeQuantityBreakPricing({
  qty,
  qtyInBaseUnitPerUnit,
  retailUnitPrice,
  baseUnitName,
  wholesaleEnabled,
  wholesaleBreakQtyInBaseUnit,
  wholesaleBlockPrice,
}) {
  const normalizedQty = toNumber(qty);
  const normalizedQtyInBaseUnitPerUnit = toNumber(qtyInBaseUnitPerUnit) || 1;
  const normalizedRetailUnitPrice = roundMoney(retailUnitPrice);
  const normalizedBreakQty = toNumber(wholesaleBreakQtyInBaseUnit);
  const normalizedBlockPrice = roundMoney(wholesaleBlockPrice);
  const totalBaseQty = computeBaseQuantity(normalizedQty, normalizedQtyInBaseUnitPerUnit);

  if (!wholesaleEnabled || normalizedBreakQty <= 0 || normalizedBlockPrice <= 0 || normalizedQty <= 0) {
    return {
      lineTotal: roundMoney(normalizedQty * normalizedRetailUnitPrice),
      effectiveUnitPrice: normalizedRetailUnitPrice,
      wholesaleEnabled: Boolean(wholesaleEnabled && normalizedBreakQty > 0 && normalizedBlockPrice > 0),
      wholesaleBreakQtyInBaseUnit: normalizedBreakQty,
      wholesaleBlockPrice: normalizedBlockPrice,
      wholesaleBlocksApplied: 0,
      wholesaleBaseQtyApplied: 0,
      retailRemainderBaseQty: totalBaseQty,
      pricingBreakdown: '',
    };
  }

  const retailPricePerBaseUnit = normalizedRetailUnitPrice / normalizedQtyInBaseUnitPerUnit;
  const wholesaleBlocksApplied = Math.floor(totalBaseQty / normalizedBreakQty);
  const wholesaleBaseQtyApplied = wholesaleBlocksApplied * normalizedBreakQty;
  const retailRemainderBaseQty = Math.max(0, totalBaseQty - wholesaleBaseQtyApplied);
  const lineTotal = roundMoney(
    wholesaleBlocksApplied * normalizedBlockPrice +
    retailRemainderBaseQty * retailPricePerBaseUnit
  );
  const parts = [];
  if (wholesaleBaseQtyApplied > 0) {
    parts.push(`${formatBaseQtyLabel(wholesaleBaseQtyApplied, baseUnitName)} wholesale`);
  }
  if (retailRemainderBaseQty > 0) {
    parts.push(`${formatBaseQtyLabel(retailRemainderBaseQty, baseUnitName)} retail`);
  }

  return {
    lineTotal,
    effectiveUnitPrice: normalizedQty > 0 ? roundMoney(lineTotal / normalizedQty) : normalizedRetailUnitPrice,
    wholesaleEnabled: true,
    wholesaleBreakQtyInBaseUnit: normalizedBreakQty,
    wholesaleBlockPrice: normalizedBlockPrice,
    wholesaleBlocksApplied,
    wholesaleBaseQtyApplied: roundQty(wholesaleBaseQtyApplied),
    retailRemainderBaseQty: roundQty(retailRemainderBaseQty),
    pricingBreakdown: parts.join(' + '),
  };
}

export async function loadProductUnitMeta(conn, productIds) {
  const ids = Array.from(new Set((productIds ?? []).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => '?').join(', ');
  const [products] = await conn.query(
    `SELECT
       p.id,
       p.unit_id,
       p.base_unit_id,
       p.default_purchase_unit_id,
       p.default_selling_unit_id,
       p.cost_price,
       p.default_cost,
       p.retail_price,
       p.wholesale_price,
       p.special_price,
       p.selling_price,
       bu.name AS base_unit_name,
       pu.name AS purchase_unit_name
     FROM inv_products p
     LEFT JOIN inv_units bu ON bu.id COLLATE utf8mb4_unicode_ci = COALESCE(p.base_unit_id, p.unit_id) COLLATE utf8mb4_unicode_ci
     LEFT JOIN inv_units pu ON pu.id COLLATE utf8mb4_unicode_ci = COALESCE(p.default_purchase_unit_id, p.unit_id) COLLATE utf8mb4_unicode_ci
     WHERE p.id IN (${placeholders})`,
    ids
  );

  const [sellingUnits] = await conn.query(
    `SELECT
       su.*,
       u.name AS unit_name
     FROM inv_product_selling_units su
     LEFT JOIN inv_units u ON u.id COLLATE utf8mb4_unicode_ci = su.unit_id COLLATE utf8mb4_unicode_ci
     WHERE su.product_id IN (${placeholders})
     ORDER BY su.sort_order ASC, su.created_at ASC`,
    ids
  );

  const map = new Map();
  for (const product of products) {
    map.set(product.id, {
      ...product,
      sellingUnits: [],
    });
  }

  for (const row of sellingUnits) {
    const product = map.get(row.product_id);
    if (!product) continue;
      product.sellingUnits.push({
        ...row,
        qty_in_base_unit: toNumber(row.qty_in_base_unit) || 1,
        retail_price: roundMoney(row.retail_price ?? row.selling_price),
        wholesale_price: roundMoney(row.wholesale_price),
        special_price: roundMoney(row.special_price),
        wholesale_enabled: Boolean(row.wholesale_enabled),
        wholesale_break_qty_in_base_unit: toNumber(row.wholesale_break_qty_in_base_unit),
        wholesale_block_price: roundMoney(row.wholesale_block_price),
        selling_price: roundMoney(row.selling_price ?? row.retail_price),
        is_default: Boolean(row.is_default),
      });
  }

  return map;
}

export function resolveSaleLineUnits(meta, item) {
  const selectedPriceLevel = normalizePriceLevel(item.selected_price_level);
  const sellingUnit =
    meta?.sellingUnits?.find(unit => unit.id === item.selected_unit_id) ??
    meta?.sellingUnits?.find(unit => unit.is_default) ??
    meta?.sellingUnits?.[0] ??
    null;

  const qtyInBaseUnitPerUnit = roundQty(
    item.qty_in_base_unit_per_unit
      ?? sellingUnit?.qty_in_base_unit
      ?? 1
  ) || 1;
  const qty = roundQty(item.qty);
  const totalBaseQty = roundQty(item.total_base_qty_deducted ?? computeBaseQuantity(qty, qtyInBaseUnitPerUnit));
  const unitPrice = roundMoney(item.unit_price);
  const retailUnitPrice = roundMoney(item.retail_unit_price ?? unitPrice);
  const quantityBreakPricing = computeQuantityBreakPricing({
    qty,
    qtyInBaseUnitPerUnit,
    retailUnitPrice,
    baseUnitName: item.base_unit_name ?? meta?.base_unit_name ?? '',
    wholesaleEnabled: item.wholesale_enabled ?? sellingUnit?.wholesale_enabled,
    wholesaleBreakQtyInBaseUnit: item.wholesale_break_qty_in_base_unit ?? sellingUnit?.wholesale_break_qty_in_base_unit,
    wholesaleBlockPrice: item.wholesale_block_price ?? sellingUnit?.wholesale_block_price,
  });

  return {
    qty,
    qtyInBaseUnitPerUnit,
    totalBaseQty,
    selectedUnitId: item.selected_unit_id ?? sellingUnit?.id ?? null,
    selectedUnitName: item.selected_unit_name ?? sellingUnit?.unit_name ?? meta?.base_unit_name ?? '',
    baseUnitName: item.base_unit_name ?? meta?.base_unit_name ?? '',
    selectedPriceLevel,
    appliedPriceLevel: normalizePriceLevel(item.applied_price_level ?? selectedPriceLevel),
    priceSource: item.price_source || item.applied_price_level || selectedPriceLevel,
    unitPrice,
    retailUnitPrice,
    wholesaleEnabled: Boolean(item.wholesale_enabled ?? quantityBreakPricing.wholesaleEnabled),
    wholesaleBreakQtyInBaseUnit: roundQty(
      item.wholesale_break_qty_in_base_unit ?? quantityBreakPricing.wholesaleBreakQtyInBaseUnit
    ),
    wholesaleBlockPrice: roundMoney(item.wholesale_block_price ?? quantityBreakPricing.wholesaleBlockPrice),
    wholesaleBlocksApplied: Math.max(0, Math.trunc(toNumber(item.wholesale_blocks_applied ?? quantityBreakPricing.wholesaleBlocksApplied))),
    wholesaleBaseQtyApplied: roundQty(item.wholesale_base_qty_applied ?? quantityBreakPricing.wholesaleBaseQtyApplied),
    retailRemainderBaseQty: roundQty(item.retail_remainder_base_qty ?? quantityBreakPricing.retailRemainderBaseQty),
    pricingBreakdown: String(item.pricing_breakdown ?? quantityBreakPricing.pricingBreakdown ?? ''),
    costPerBaseUnit: roundMoney(
      item.cost_per_base_unit
        ?? meta?.cost_price
        ?? computeCostPerBase(meta?.default_cost ?? 0, qtyInBaseUnitPerUnit)
    ),
  };
}

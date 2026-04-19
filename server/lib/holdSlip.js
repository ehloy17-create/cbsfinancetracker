import jwt from 'jsonwebtoken';
import pool from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const HOLD_SLIP_PURPOSE = 'hold-slip';

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function getHoldSlipExpiry(now = new Date()) {
  const expiry = new Date(now);
  expiry.setHours(23, 59, 59, 999);
  return expiry;
}

export function generateHoldSlipToken(heldSaleId, now = new Date()) {
  const expiry = getHoldSlipExpiry(now);
  const expirySeconds = Math.max(
    Math.floor(expiry.getTime() / 1000),
    Math.floor(Date.now() / 1000) + 60
  );

  const token = jwt.sign({
    purpose: HOLD_SLIP_PURPOSE,
    heldSaleId,
    exp: expirySeconds,
  }, JWT_SECRET);

  return {
    token,
    expiresAt: new Date(expirySeconds * 1000).toISOString(),
  };
}

export function validateHoldSlipToken(token, heldSaleId) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.purpose !== HOLD_SLIP_PURPOSE || payload?.heldSaleId !== heldSaleId) {
      return {
        valid: false,
        status: 401,
        code: 'HOLD_SLIP_INVALID',
        message: 'Invalid hold slip token',
      };
    }

    return {
      valid: true,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    };
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return {
        valid: false,
        status: 410,
        code: 'HOLD_SLIP_EXPIRED',
        message: 'This hold slip has expired',
      };
    }

    return {
      valid: false,
      status: 401,
      code: 'HOLD_SLIP_INVALID',
      message: 'Invalid hold slip token',
    };
  }
}

export function buildHoldSlipUrl(heldSaleId, token, appBaseUrl) {
  const baseUrl = String(appBaseUrl ?? '').replace(/\/+$/, '');
  return `${baseUrl}/hold-slip/${encodeURIComponent(heldSaleId)}?token=${encodeURIComponent(token)}`;
}

export async function getHoldSlipData(heldSaleId) {
  const [holdRows] = await pool.query(
    `SELECT
        hs.held_sale_id,
        hs.hold_reference,
        hs.customer_name_snapshot,
        hs.customer_price_level_snapshot,
        hs.status,
        hs.subtotal,
        hs.notes,
        hs.created_at,
        hs.updated_at,
        COALESCE(p.name, '—') AS cashier_name
      FROM held_sales hs
      LEFT JOIN profiles p ON p.id = hs.cashier_id
      WHERE hs.held_sale_id = ?
      LIMIT 1`,
    [heldSaleId]
  );

  const hold = holdRows[0];
  if (!hold) return null;

  const [itemRows] = await pool.query(
    `SELECT
        item_id,
        product_name_snapshot,
        qty,
        unit_price,
        subtotal,
        selected_unit_name,
        base_unit_name,
        pricing_breakdown
      FROM held_sale_items
      WHERE held_sale_id = ?
      ORDER BY sort_order ASC, item_id ASC`,
    [heldSaleId]
  );

  return {
    held_sale_id: String(hold.held_sale_id),
    hold_reference: String(hold.hold_reference ?? ''),
    customer_name_snapshot: String(hold.customer_name_snapshot ?? 'Walk-in'),
    customer_price_level_snapshot: String(hold.customer_price_level_snapshot ?? 'Retail'),
    status: String(hold.status ?? 'held'),
    subtotal: Number(hold.subtotal ?? 0),
    notes: String(hold.notes ?? ''),
    created_at: toIsoString(hold.created_at),
    updated_at: toIsoString(hold.updated_at),
    cashier_name: String(hold.cashier_name ?? '—'),
    items: itemRows.map(item => ({
      item_id: String(item.item_id),
      product_name_snapshot: String(item.product_name_snapshot ?? ''),
      qty: Number(item.qty ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      subtotal: Number(item.subtotal ?? 0),
      selected_unit_name: String(item.selected_unit_name ?? ''),
      base_unit_name: String(item.base_unit_name ?? ''),
      pricing_breakdown: String(item.pricing_breakdown ?? ''),
    })),
  };
}

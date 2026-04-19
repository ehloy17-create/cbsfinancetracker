import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdminRole } from '../lib/accessControl.js';
import { resolveAppBaseUrlFromRequest } from '../lib/network.js';
import {
  buildHoldSlipUrl,
  generateHoldSlipToken,
  getHoldSlipData,
  validateHoldSlipToken,
} from '../lib/holdSlip.js';

const router = Router();

router.post('/:heldSaleId/link', requireAuth, async (req, res) => {
  const heldSaleId = String(req.params.heldSaleId ?? '').trim();
  if (!heldSaleId) {
    return res.status(400).json({ error: 'heldSaleId is required' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT held_sale_id, cashier_id, status
       FROM held_sales
       WHERE held_sale_id = ?
       LIMIT 1`,
      [heldSaleId]
    );

    const hold = rows[0];
    if (!hold) {
      return res.status(404).json({ error: 'Hold slip not found' });
    }

    if (!isAdminRole(req.user?.role) && String(hold.cashier_id ?? '') !== req.user?.id) {
      return res.status(403).json({ error: 'You cannot share this hold slip' });
    }

    if (String(hold.status ?? '') !== 'held') {
      return res.status(400).json({ error: 'Only active held transactions can be shared' });
    }

    const { token, expiresAt } = generateHoldSlipToken(heldSaleId);
    const appBaseUrl = resolveAppBaseUrlFromRequest(req, process.env.API_PORT || 4000);
    return res.json({
      heldSaleId,
      token,
      expiresAt,
      link: buildHoldSlipUrl(heldSaleId, token, appBaseUrl),
    });
  } catch (error) {
    console.error('POST /hold-slip/:heldSaleId/link:', error);
    return res.status(500).json({ error: 'Failed to generate hold slip link' });
  }
});

router.get('/public/:heldSaleId', async (req, res) => {
  const heldSaleId = String(req.params.heldSaleId ?? '').trim();
  const token = String(req.query.token ?? '').trim();

  if (!heldSaleId || !token) {
    return res.status(401).json({
      error: 'Invalid hold slip token',
      code: 'HOLD_SLIP_INVALID',
    });
  }

  const validation = validateHoldSlipToken(token, heldSaleId);
  if (!validation.valid) {
    return res.status(validation.status).json({
      error: validation.message,
      code: validation.code,
    });
  }

  try {
    const holdSlip = await getHoldSlipData(heldSaleId);
    if (!holdSlip || holdSlip.status !== 'held') {
      return res.status(404).json({ error: 'Hold slip not found' });
    }

    return res.json({
      data: holdSlip,
      expiresAt: validation.expiresAt,
    });
  } catch (error) {
    console.error('GET /hold-slip/public/:heldSaleId:', error);
    return res.status(500).json({ error: 'Failed to load hold slip' });
  }
});

export default router;

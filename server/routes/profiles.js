import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdminRole, isKnownUserRole } from '../lib/accessControl.js';

const router = Router();

// GET /profiles  (with optional query filters, e.g. ?id=eq.xxx)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { id } = req.query;
    let sql = 'SELECT id, name, email, role, status, created_at, last_login FROM profiles WHERE 1=1';
    const params = [];

    if (id) {
      const val = id.replace(/^eq\./, '');
      sql += ' AND id = ?';
      params.push(val);
    }

    if (!isAdminRole(req.user?.role)) {
      sql += ' AND id = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /profiles?id=eq.xxx
router.patch('/', requireAuth, async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id filter required' });

  const targetId = id.replace(/^eq\./, '');
  const { password_hash, ...fields } = req.body;  // never allow direct hash update here
  const allowed  = ['name', 'email', 'role', 'status', 'last_login'];
  const updates  = Object.keys(fields).filter(k => allowed.includes(k));

  if (!isAdminRole(req.user?.role)) {
    const selfUpdates = Object.keys(fields).filter(k => k === 'last_login');
    if (targetId !== req.user.id || selfUpdates.length !== Object.keys(fields).length) {
      return res.status(403).json({ error: 'You cannot update this profile' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'role') && !isKnownUserRole(fields.role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (updates.length === 0 && !(Object.keys(fields).length === 1 && Object.prototype.hasOwnProperty.call(fields, 'last_login')))
    return res.json([]);

  try {
    const safeUpdates = isAdminRole(req.user?.role)
      ? updates
      : ['last_login'];
    const sets = safeUpdates.map(k => `${k} = ?`).join(', ');
    const vals = safeUpdates.map(k => fields[k]);
    await pool.query(`UPDATE profiles SET ${sets} WHERE id = ?`, [...vals, targetId]);
    const [rows] = await pool.query(
      'SELECT id, name, email, role, status, created_at, last_login FROM profiles WHERE id = ?',
      [targetId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

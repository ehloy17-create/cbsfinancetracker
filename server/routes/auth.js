import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { isAdminRole, isKnownUserRole, normalizeUserRole } from '../lib/accessControl.js';

const router = Router();

// ── POST /auth/sign-in ───────────────────────────────────────
router.post('/sign-in', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const [rows] = await pool.query(
      'SELECT * FROM profiles WHERE email = ? AND status = "active" LIMIT 1',
      [email]
    );

    const user = rows[0];
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    // Update last login
    await pool.query('UPDATE profiles SET last_login = NOW() WHERE id = ?', [user.id]);

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    const { password_hash, ...profile } = user;
    res.json({
      data: {
        session: {
          access_token: token,
          token_type: 'bearer',
          user: { id: user.id, email: user.email },
        },
        user: { id: user.id, email: user.email },
      },
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /auth/sign-out ──────────────────────────────────────
router.post('/sign-out', (_req, res) => {
  // JWT is stateless; client just discards the token
  res.json({ error: null });
});

// ── POST /auth/sign-up ───────────────────────────────────────
// Used by admin to create new users
router.post('/sign-up', requireAuth, async (req, res) => {
  if (!isAdminRole(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access is required' });
  }

  const requestedRole = req.body?.role;
  const role = normalizeUserRole(requestedRole, 'staff');
  const { email, password, name } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  if (requestedRole != null && !isKnownUserRole(requestedRole))
    return res.status(400).json({ error: 'Invalid role' });

  try {
    const [existing] = await pool.query(
      'SELECT id FROM profiles WHERE email = ? LIMIT 1', [email]
    );
    if (existing.length > 0)
      return res.status(400).json({ error: 'Email already registered' });

    const id   = uuidv4();
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO profiles (id, name, email, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [id, name || email, email, hash, role]
    );

    const [rows] = await pool.query(
      'SELECT id, name, email, role, status, created_at, last_login, module_access FROM profiles WHERE id = ?',
      [id]
    );

    res.json({
      data: { user: { id, email }, profile: rows[0] },
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /auth/session ────────────────────────────────────────
router.get('/session', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, status, created_at, last_login, module_access FROM profiles WHERE id = ?',
      [req.user.id]
    );
    const profile = rows[0];
    if (!profile)
      return res.status(404).json({ data: { session: null }, error: null });

    const token = signToken({ id: profile.id, email: profile.email, role: profile.role });
    res.json({
      data: {
        session: {
          access_token: token,
          token_type: 'bearer',
          user: { id: profile.id, email: profile.email },
        },
      },
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /auth/admin/update-user  (change password) ─────────
router.post('/admin/update-user', requireAuth, async (req, res) => {
  if (!isAdminRole(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access is required' });
  }

  const { userId, password } = req.body;
  if (!userId || !password)
    return res.status(400).json({ error: 'userId and password required' });

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE profiles SET password_hash = ? WHERE id = ?', [hash, userId]);
    res.json({ data: { user: { id: userId } }, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

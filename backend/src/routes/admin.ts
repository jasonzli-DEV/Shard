/**
 * Admin routes — mounted at /api/admin, admin-only.
 *
 * GET    /api/admin/users              — list all users
 * POST   /api/admin/users/:id/approve  — set status='active'
 * POST   /api/admin/users/:id/deny     — delete user (not self, not last admin)
 * POST   /api/admin/users/:id/role     — set role (not self)
 * GET    /api/admin/access-mode        — get current accessMode
 * PUT    /api/admin/access-mode        — set accessMode ('open' | 'approval')
 * GET    /api/admin/invites            — list pending invites
 * POST   /api/admin/invites            — create invite for email
 * DELETE /api/admin/invites/:id        — delete invite
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { UserModel } from '../models/User';
import { InviteModel } from '../models/Invite';
import { getStarter } from '../lib/db';
import { getConfig, saveConfig } from '../config/configService';
import { logger } from '../utils/logger';

const router = Router();

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setAdminConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getModel<T>(Model: mongoose.Model<T>): mongoose.Model<T> {
  const conn = getConn();
  try {
    return conn.model(Model.modelName) as mongoose.Model<T>;
  } catch {
    return conn.model(Model.modelName, Model.schema) as mongoose.Model<T>;
  }
}

// All routes require auth
router.use(requireAuth);

// Admin-only guard
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).userId as string;
  try {
    const User = getModel(UserModel);
    const user = await User.findById(userId).lean().select('role');
    if (!user || (user as any).role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  } catch (err) {
    logger.error('requireAdmin error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.use(requireAdmin);

// ── GET /api/admin/users ───────────────────────────────────────────────────────
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const User = getModel(UserModel);
    const users = await User.find({}).lean().sort({ createdAt: 1 });
    res.json(
      users.map((u: any) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.displayName,
        provider: u.provider,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      }))
    );
  } catch (err) {
    logger.error('GET /api/admin/users error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/users/:id/approve ─────────────────────────────────────────
router.post('/users/:id/approve', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }

  try {
    const User = getModel(UserModel);
    const user = await User.findByIdAndUpdate(
      id,
      { status: 'active' },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ id: user._id.toString(), status: user.status });
  } catch (err) {
    logger.error('POST /api/admin/users/:id/approve error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/users/:id/deny ────────────────────────────────────────────
router.post('/users/:id/deny', async (req: Request, res: Response) => {
  const { id } = req.params;
  const actingUserId = (req as any).userId as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }

  // Cannot deny yourself
  if (id === actingUserId) {
    res.status(400).json({ error: 'Cannot deny yourself' });
    return;
  }

  try {
    const User = getModel(UserModel);
    const target = await User.findById(id).lean();

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Cannot deny the last admin
    if ((target as any).role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot deny the last admin' });
        return;
      }
    }

    await User.deleteOne({ _id: id });
    res.json({ message: 'User denied and removed' });
  } catch (err) {
    logger.error('POST /api/admin/users/:id/deny error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/users/:id/role ────────────────────────────────────────────
router.post('/users/:id/role', async (req: Request, res: Response) => {
  const { id } = req.params;
  const actingUserId = (req as any).userId as string;
  const { role } = req.body as { role?: string };

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }

  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }

  // Cannot demote yourself
  if (id === actingUserId && role !== 'admin') {
    res.status(400).json({ error: 'Cannot change your own role' });
    return;
  }

  try {
    const User = getModel(UserModel);

    // Don't demote last admin
    if (role === 'user') {
      const target = await User.findById(id).lean();
      if (target && (target as any).role === 'admin') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot demote the last admin' });
          return;
        }
      }
    }

    const user = await User.findByIdAndUpdate(id, { role }, { new: true });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ id: user._id.toString(), role: user.role });
  } catch (err) {
    logger.error('POST /api/admin/users/:id/role error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/access-mode ────────────────────────────────────────────────
router.get('/access-mode', (_req: Request, res: Response) => {
  const cfg = getConfig();
  res.json({ accessMode: cfg.accessMode });
});

// ── PUT /api/admin/access-mode ────────────────────────────────────────────────
router.put('/access-mode', async (req: Request, res: Response) => {
  const { accessMode } = req.body as { accessMode?: string };

  if (accessMode !== 'open' && accessMode !== 'approval') {
    res.status(400).json({ error: 'accessMode must be "open" or "approval"' });
    return;
  }

  try {
    await saveConfig({ accessMode });
    res.json({ accessMode });
  } catch (err) {
    logger.error('PUT /api/admin/access-mode error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/invites ────────────────────────────────────────────────────
router.get('/invites', async (_req: Request, res: Response) => {
  try {
    const Invite = getModel(InviteModel);
    const invites = await Invite.find({}).lean().sort({ createdAt: -1 });
    res.json(
      invites.map((inv: any) => ({
        id: inv._id.toString(),
        email: inv.email,
        createdBy: inv.createdBy.toString(),
        createdAt: inv.createdAt,
      }))
    );
  } catch (err) {
    logger.error('GET /api/admin/invites error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/invites ───────────────────────────────────────────────────
router.post('/invites', async (req: Request, res: Response) => {
  const actingUserId = (req as any).userId as string;
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const Invite = getModel(InviteModel);
    // Check if already exists
    const existing = await Invite.findOne({ email: normalizedEmail });
    if (existing) {
      res.status(409).json({ error: 'Invite already exists for that email' });
      return;
    }

    const invite = await Invite.create({
      email: normalizedEmail,
      createdBy: new mongoose.Types.ObjectId(actingUserId),
    });

    res.status(201).json({
      id: invite._id.toString(),
      email: invite.email,
      createdBy: actingUserId,
      createdAt: (invite as any).createdAt,
    });
  } catch (err) {
    logger.error('POST /api/admin/invites error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/admin/invites/:id ─────────────────────────────────────────────
router.delete('/invites/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid invite id' });
    return;
  }

  try {
    const Invite = getModel(InviteModel);
    const result = await Invite.deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    res.json({ message: 'Invite deleted' });
  } catch (err) {
    logger.error('DELETE /api/admin/invites/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

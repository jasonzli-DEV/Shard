/**
 * Shares routes — Phase 6.1
 *
 * Endpoints:
 *   POST   /api/files/:id/share           — share a file (owner only)
 *   DELETE /api/files/:id/share/:userId   — unshare (owner only)
 *   GET    /api/files/:id/shares          — list shares for a file (owner only)
 *   GET    /api/shared-with-me            — files shared with current user
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { UserModel } from '../models/User';
import { getStarter } from '../lib/db';
import * as sharesService from '../services/shares';
import { logger } from '../utils/logger';

const router = Router();

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setSharesConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

// Ensure UserModel is registered on the test connection (the share service
// queries UserModel directly using the default mongoose connection; we need to
// ensure it is registered there too).
function ensureModels(): void {
  const conn = getConn();
  try {
    conn.model(UserModel.modelName);
  } catch {
    conn.model(UserModel.modelName, UserModel.schema);
  }
}

// All routes require auth
router.use(requireAuth);

// ── POST /api/files/:id/share ─────────────────────────────────────────────────
router.post('/files/:id/share', async (req: Request, res: Response) => {
  ensureModels();
  const callerId = (req as any).userId as string;
  const { id: fileId } = req.params;
  const { email, userId: recipientUserId, permission } = req.body as {
    email?: string;
    userId?: string;
    permission?: string;
  };

  if (!email && !recipientUserId) {
    res.status(400).json({ error: 'Provide email or userId for recipient' });
    return;
  }

  if (!permission || (permission !== 'view' && permission !== 'edit')) {
    res.status(400).json({ error: 'permission must be view or edit' });
    return;
  }

  try {
    const { share, isNew } = await sharesService.shareFile(
      callerId,
      fileId,
      { email, userId: recipientUserId },
      permission as 'view' | 'edit',
    );

    res.status(isNew ? 201 : 200).json(share);
  } catch (err: any) {
    if (err.code === 'OWNER_ONLY') {
      res.status(403).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else if (err.code === 'SHARE_SELF') {
      res.status(400).json({ error: err.message });
    } else if (err.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: err.message });
    } else {
      logger.error('POST /api/files/:id/share error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── DELETE /api/files/:id/share/:userId ──────────────────────────────────────
router.delete('/files/:id/share/:userId', async (req: Request, res: Response) => {
  const callerId = (req as any).userId as string;
  const { id: fileId, userId: sharedWithId } = req.params;

  try {
    await sharesService.unshareFile(callerId, fileId, sharedWithId);
    res.json({ message: 'Share removed' });
  } catch (err: any) {
    if (err.code === 'OWNER_ONLY') {
      res.status(403).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('DELETE /api/files/:id/share/:userId error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── GET /api/files/:id/shares ─────────────────────────────────────────────────
router.get('/files/:id/shares', async (req: Request, res: Response) => {
  const callerId = (req as any).userId as string;
  const { id: fileId } = req.params;

  try {
    const shares = await sharesService.listFileShares(callerId, fileId);
    res.json(shares);
  } catch (err: any) {
    if (err.code === 'OWNER_ONLY') {
      res.status(403).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('GET /api/files/:id/shares error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── GET /api/shared-with-me ───────────────────────────────────────────────────
router.get('/shared-with-me', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const items = await sharesService.listSharedWithMe(userId);
    res.json(items);
  } catch (err: any) {
    logger.error('GET /api/shared-with-me error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

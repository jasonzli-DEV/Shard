/**
 * Cron endpoints for Vercel Cron (or any external scheduler).
 *
 * POST /api/cron/storage-check    — run storage check for all users
 * POST /api/cron/decommission     — run empty-cluster decommission sweep
 *
 * Auth: Authorization: Bearer <CRON_SECRET> OR x-cron-secret: <CRON_SECRET>
 * Returns 401 if secret is missing/wrong.
 * Returns 204 if CRON_SECRET is not configured (no-op, safe).
 */

import { Router, Request, Response } from 'express';
import { runStorageCheckAllUsers, runDecommissionSweep } from '../storage/scheduler';
import { logger } from '../utils/logger';

const router = Router();

function authorizeCron(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET;

  // If no secret configured, disable cron endpoints entirely
  if (!secret) {
    res.status(204).send();
    return false;
  }

  const authHeader = req.headers.authorization;
  const cronHeader = req.headers['x-cron-secret'] as string | undefined;

  const provided =
    (authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null) ??
    cronHeader ??
    null;

  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

// POST /api/cron/storage-check
router.post('/storage-check', async (req: Request, res: Response) => {
  if (!authorizeCron(req, res)) return;

  try {
    await runStorageCheckAllUsers();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Cron storage-check error', { error: (err as Error).message });
    res.status(500).json({ error: 'Storage check failed' });
  }
});

// POST /api/cron/decommission
router.post('/decommission', async (req: Request, res: Response) => {
  if (!authorizeCron(req, res)) return;

  try {
    await runDecommissionSweep();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Cron decommission error', { error: (err as Error).message });
    res.status(500).json({ error: 'Decommission sweep failed' });
  }
});

export default router;

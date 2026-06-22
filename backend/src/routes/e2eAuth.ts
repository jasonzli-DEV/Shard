/**
 * E2E-only test auth route.
 *
 * This module MUST only be loaded when SHARD_E2E=1. It provides a test-only
 * login endpoint that bypasses real OAuth — strictly for Playwright E2E tests.
 *
 * PRODUCTION SAFETY: This router is only mounted in app.ts when
 * process.env.SHARD_E2E === '1'. It never exists in production.
 *
 * Endpoint:
 *   POST /api/e2e/login
 *   Body: { email: string; displayName?: string }
 *   Response: { token: string } + sets shard_token cookie
 *
 * The endpoint creates (or retrieves) a user with the given email,
 * creates a session, and returns the JWT in a cookie.
 */

import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { upsertUserFromProfile } from '../auth/passport';
import { createSession } from '../auth/sessions';
import { StorageClusterModel } from '../models';
import { openCluster } from '../storage/clusterManager';
import { logger } from '../utils/logger';

const router = Router();

const COOKIE_NAME = 'shard_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/e2e/login
 * Creates or retrieves a test user and issues a session cookie.
 *
 * ONLY available when SHARD_E2E=1.
 */
router.post('/login', async (req: Request, res: Response) => {
  // Double-check guard at request time as defence-in-depth
  if (process.env.SHARD_E2E !== '1') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { email, displayName } = req.body as { email?: string; displayName?: string };

  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  try {
    const user = await upsertUserFromProfile({
      provider: 'github',
      id: `e2e-${email}`,
      displayName: displayName ?? email,
      email,
    });

    const token = await createSession(user._id.toString());

    // ── E2E storage bootstrap ─────────────────────────────────────────────────
    // Create a fake StorageCluster pointing to the local in-memory MongoDB so
    // that storeFile() / ensureCapacity() can actually write files during E2E.
    const starterUri = process.env['STARTER_MONGODB_URI']!;
    const e2eClusterId = `e2e-cluster-${user._id.toString()}`;

    // Upsert a "fake" StorageCluster for this user pointing to local mongo
    await StorageClusterModel.findOneAndUpdate(
      { userId: new Types.ObjectId(user._id.toString()), clusterId: e2eClusterId },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(user._id.toString()),
          orgKeyId: new Types.ObjectId('000000000000000000000000'), // placeholder
          clusterId: e2eClusterId,
          projectId: 'e2e-project',
          clusterName: e2eClusterId,
          connectionUri: starterUri,
          status: 'active' as const,
          storageUsedBytes: 0,
          storageCapacityBytes: 512 * 1024 * 1024,
        },
      },
      { upsert: true, new: true },
    );

    // Open the cluster connection in the cluster manager so getBucket() works
    try {
      await openCluster({
        clusterId: e2eClusterId,
        connectionUri: starterUri,
        userId: user._id.toString(),
        status: 'active',
      });
    } catch (e) {
      logger.warn('E2E cluster open warning (non-fatal)', { error: (e as Error).message });
    }

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: false, // E2E runs over HTTP
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error('E2E login error', { error: (err as Error).message });
    res.status(500).json({ error: 'E2E login failed' });
  }
});

export { router as e2eAuthRouter };

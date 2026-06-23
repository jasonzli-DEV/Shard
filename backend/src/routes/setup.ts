/**
 * Setup routes — first-run configuration wizard backend.
 *
 * GET  /api/setup/status          → { setupRequired, configured }
 * POST /api/setup/test-connection → { ok, error? } (pings starter MongoDB URI)
 * POST /api/setup/configure       → saves config to DB; refuses if already done
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { configurePassport } from '../auth/passport';
import {
  saveConfig,
  loadConfig,
  getConfig,
  isConfigured,
} from '../config/configService';

const router = Router();

// ── Status helpers ────────────────────────────────────────────────────────────

function getConfiguredFlags() {
  const cfg = getConfig();
  return {
    starterDb: !!process.env.STARTER_MONGODB_URI,
    jwt: !!cfg.jwtSecret,
    google: !!(cfg.googleClientId && cfg.googleClientSecret),
    github: !!(cfg.githubClientId && cfg.githubClientSecret),
    publicUrl: !!cfg.publicUrl,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/setup/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    setupRequired: !isConfigured(),
    configured: getConfiguredFlags(),
  });
});

// POST /api/setup/test-connection
router.post('/test-connection', async (req: Request, res: Response) => {
  const { starterUri } = req.body as { starterUri?: string };

  if (!starterUri || typeof starterUri !== 'string' || !starterUri.trim()) {
    return res.status(400).json({ error: 'starterUri is required' });
  }

  let conn: mongoose.Connection | null = null;
  try {
    conn = mongoose.createConnection(starterUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 5000,
    });

    // Wait for the connection to open or error
    await conn.asPromise();

    return res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`test-connection failed: ${message}`);
    return res.json({ ok: false, error: message });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        // ignore close errors
      }
    }
  }
});

// POST /api/setup/configure
interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

interface ConfigureBody {
  starterUri?: string;
  google?: Partial<OAuthCreds>;
  github?: Partial<OAuthCreds>;
  publicUrl?: string;
  allowedOrigins?: string;
}

router.post('/configure', async (req: Request, res: Response) => {
  // Guard: refuse if already configured
  if (isConfigured()) {
    return res.status(403).json({
      error: 'Setup already complete',
      message: 'Configuration is stored in the database. Use the admin panel to change settings.',
    });
  }

  const { starterUri, google, github, publicUrl, allowedOrigins } =
    req.body as ConfigureBody;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!starterUri || typeof starterUri !== 'string' || !starterUri.trim()) {
    return res.status(400).json({ error: 'starterUri is required' });
  }

  const hasGoogle = !!(google?.clientId && google?.clientSecret);
  const hasGithub = !!(github?.clientId && github?.clientSecret);

  if (!hasGoogle && !hasGithub) {
    return res.status(400).json({
      error: 'At least one OAuth provider (Google or GitHub) is required',
    });
  }

  // Partial provider — id without secret or vice versa
  if (google && !(google.clientId && google.clientSecret)) {
    return res.status(400).json({
      error: 'Google OAuth requires both clientId and clientSecret',
    });
  }
  if (github && !(github.clientId && github.clientSecret)) {
    return res.status(400).json({
      error: 'GitHub OAuth requires both clientId and clientSecret',
    });
  }

  // ── Connect to starter DB so we can save config ───────────────────────────
  // In setup mode the app has no DB connection yet; open a temporary one
  // to the provided starterUri so saveConfig() can write the singleton.
  // Under test (NODE_ENV==='test') the caller injects its own connection via
  // getStarter(), so we skip this step.
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { connectRuntime } = await import('../lib/runtime');
      await connectRuntime(starterUri);
      logger.info('Setup: runtime connected to starter');
    } catch (err) {
      logger.error('Setup: failed to connect to starter DB', err);
      return res.status(500).json({
        error: 'Could not connect to the provided starterUri',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Persist config to DB ───────────────────────────────────────────────────
  try {
    await saveConfig({
      googleClientId: hasGoogle ? google!.clientId! : undefined,
      googleClientSecret: hasGoogle ? google!.clientSecret! : undefined,
      githubClientId: hasGithub ? github!.clientId! : undefined,
      githubClientSecret: hasGithub ? github!.clientSecret! : undefined,
      publicUrl: publicUrl ?? undefined,
      allowedOrigins: allowedOrigins ?? undefined,
    });
    logger.info('Setup: config persisted to DB');
  } catch (err) {
    logger.error('Setup: failed to save config to DB', err);
    return res.status(500).json({
      error: 'Failed to save configuration to database',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Bootstrap in-process env so isConfigured() guard works immediately ────
  process.env.STARTER_MONGODB_URI = starterUri;
  logger.info('Setup: process.env.STARTER_MONGODB_URI set, setup complete');

  // Re-initialize passport strategies so OAuth login works immediately
  // without requiring a server restart.
  try {
    configurePassport();
    logger.info('Setup: passport strategies re-initialized');
  } catch (err) {
    logger.warn('Setup: passport re-init failed (non-fatal)', err);
  }

  // Reload config cache after save (already refreshed by saveConfig, but
  // also call loadConfig() so non-test runtimes get a fully hydrated cache).
  if (process.env.NODE_ENV !== 'test') {
    try {
      await loadConfig();
    } catch (err) {
      logger.warn('Setup: loadConfig after configure failed (non-fatal)', err);
    }
  }

  return res.json({
    success: true,
    message: 'Configuration saved. You can now sign in.',
  });
});

export default router;

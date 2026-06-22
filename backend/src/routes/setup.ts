/**
 * Setup routes — first-run configuration wizard backend.
 *
 * GET  /api/setup/status          → { setupRequired, configured }
 * POST /api/setup/test-connection → { ok, error? } (pings starter MongoDB URI)
 * POST /api/setup/configure       → writes .env + live process.env, refuses if already done
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { configurePassport } from '../auth/passport';

const router = Router();

// Allow tests to override the env file path via SETUP_ENV_FILE_PATH.
// Default: /app/config/.env — must match the volume mount in docker-compose.yml.
// In development, set SETUP_ENV_FILE_PATH to an absolute writable path.
function getEnvFilePath(): string {
  return process.env.SETUP_ENV_FILE_PATH ?? path.join(process.cwd(), 'config', '.env');
}

// ── Setup-complete logic ──────────────────────────────────────────────────────

/** Setup is complete when we have a starter URI and at least one OAuth provider. */
function isSetupComplete(): boolean {
  const hasDb = !!process.env.STARTER_MONGODB_URI;
  const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasGithub = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  return hasDb && (hasGoogle || hasGithub);
}

function getConfiguredFlags() {
  return {
    starterDb: !!process.env.STARTER_MONGODB_URI,
    jwt: !!process.env.JWT_SECRET,
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    publicUrl: !!process.env.PUBLIC_URL,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/setup/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    setupRequired: !isSetupComplete(),
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
  if (isSetupComplete()) {
    return res.status(403).json({
      error: 'Setup already complete',
      message: 'Edit the .env file directly to change configuration.',
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

  // ── Build env updates ────────────────────────────────────────────────────────
  const jwtSecret =
    process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

  const envUpdates: Record<string, string> = {
    STARTER_MONGODB_URI: starterUri,
    JWT_SECRET: jwtSecret,
  };

  if (publicUrl) {
    envUpdates.PUBLIC_URL = publicUrl;
    envUpdates.FRONTEND_URL = publicUrl;
  }

  if (allowedOrigins) {
    envUpdates.ALLOWED_ORIGINS = allowedOrigins;
  }

  if (hasGoogle) {
    envUpdates.GOOGLE_CLIENT_ID = google!.clientId!;
    envUpdates.GOOGLE_CLIENT_SECRET = google!.clientSecret!;
  }

  if (hasGithub) {
    envUpdates.GITHUB_CLIENT_ID = github!.clientId!;
    envUpdates.GITHUB_CLIENT_SECRET = github!.clientSecret!;
  }

  // ── Write .env file ──────────────────────────────────────────────────────────
  try {
    const envFilePath = getEnvFilePath();
    const envDir = path.dirname(envFilePath);

    if (!fs.existsSync(envDir)) {
      fs.mkdirSync(envDir, { recursive: true });
    }

    let envContent = '';
    if (fs.existsSync(envFilePath)) {
      envContent = fs.readFileSync(envFilePath, 'utf-8');
    }

    const lines = envContent.split('\n');
    const existingKeys = new Set<string>();

    const updatedLines = lines.map((line) => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match && envUpdates[match[1]] !== undefined) {
        existingKeys.add(match[1]);
        return `${match[1]}=${envUpdates[match[1]]}`;
      }
      return line;
    });

    for (const [key, value] of Object.entries(envUpdates)) {
      if (!existingKeys.has(key)) {
        updatedLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(envFilePath, updatedLines.join('\n'), 'utf-8');
    logger.info(`Setup: .env written to ${envFilePath}`);
  } catch (err) {
    logger.error('Setup: failed to write .env', err);
    return res.status(500).json({
      error: 'Failed to write configuration file',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Update live process.env ──────────────────────────────────────────────────
  for (const [key, value] of Object.entries(envUpdates)) {
    process.env[key] = value;
  }
  logger.info('Setup: process.env updated, setup complete');

  // Re-initialize passport strategies so OAuth login works immediately
  // without requiring a server restart.
  try {
    configurePassport();
    logger.info('Setup: passport strategies re-initialized');
  } catch (err) {
    logger.warn('Setup: passport re-init failed (non-fatal)', err);
  }

  return res.json({
    success: true,
    message: 'Configuration saved. You can now sign in.',
  });
});

export default router;

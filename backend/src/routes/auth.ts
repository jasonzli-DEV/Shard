import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import mongoose from 'mongoose';
import { createSession } from '../auth/sessions';
import { requireAuth } from '../middleware/auth';
import { UserModel } from '../models/User';
import { getStarter } from '../lib/db';
import { logger } from '../utils/logger';

const router = Router();

const SUPPORTED_PROVIDERS = ['google', 'github'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

function isSupportedProvider(p: string): p is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

const COOKIE_NAME = 'shard_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// Allow tests to inject connection
let _overrideConn: mongoose.Connection | null = null;

export function setAuthRoutesConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getUserModel(): mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(UserModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  } catch {
    return conn.model(UserModel.modelName, UserModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  }
}

// ── /me handler (exported for mounting at /api/me in app.ts) ─────────────────
export async function meHandler(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId as string;

  try {
    const User = getUserModel();
    const user = await User.findById(userId).lean();

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id.toString(),
      provider: user.provider,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      encryptionEnabled: user.encryptionEnabled,
    });
  } catch (err) {
    logger.error('GET /api/me error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/auth/:provider ───────────────────────────────────────────────────
router.get('/:provider', (req: Request, res: Response, next: NextFunction) => {
  const { provider } = req.params;

  if (!isSupportedProvider(provider)) {
    res.status(400).json({ error: `Unsupported OAuth provider: ${provider}` });
    return;
  }

  passport.authenticate(provider, {
    session: false,
    scope: provider === 'google' ? ['profile', 'email'] : ['user:email'],
  })(req, res, next);
});

// ── GET /api/auth/:provider/callback ─────────────────────────────────────────
router.get(
  '/:provider/callback',
  (req: Request, res: Response, next: NextFunction) => {
    const { provider } = req.params;

    if (!isSupportedProvider(provider)) {
      res.status(400).json({ error: `Unsupported OAuth provider: ${provider}` });
      return;
    }

    passport.authenticate(provider, { session: false }, async (err: Error | null, user: any) => {
      if (err || !user) {
        logger.error('OAuth callback error', { provider, error: err?.message });
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        res.redirect(`${frontendUrl}/login?error=oauth_failed`);
        return;
      }

      try {
        const token = await createSession(user._id.toString());
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

        res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: COOKIE_MAX_AGE,
        });

        res.redirect(frontendUrl);
      } catch (sessionErr) {
        logger.error('Session creation failed after OAuth', { error: (sessionErr as Error).message });
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        res.redirect(`${frontendUrl}/login?error=session_failed`);
      }
    })(req, res, next);
  }
);

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out' });
});

export default router;

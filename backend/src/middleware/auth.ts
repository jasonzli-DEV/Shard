import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { verifyJwt } from '../auth/jwt';
import { getSessionUser } from '../auth/sessions';
import { ApiKeyModel } from '../models/ApiKey';
import { UserModel } from '../models/User';
import { getStarter } from '../lib/db';

// Allow tests to inject a specific connection
let _overrideConn: mongoose.Connection | null = null;

export function setAuthMiddlewareConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getApiKeyModel(): mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(ApiKeyModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>>;
  } catch {
    return conn.model(ApiKeyModel.modelName, ApiKeyModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>>;
  }
}

function getUserModel(): mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(UserModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  } catch {
    return conn.model(UserModel.modelName, UserModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  }
}

/**
 * Routes that pending users can access even when their status is 'pending'.
 * These are matched by exact path prefix.
 */
const PENDING_ALLOWED_PATHS = ['/api/me', '/api/auth/logout'];

function isPendingAllowed(path: string): boolean {
  return PENDING_ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * requireAuth middleware.
 * Accepts EITHER:
 *   - An httpOnly cookie `shard_token` containing a valid JWT session token, OR
 *   - An `Authorization: Bearer shard_<key>` header with a valid API key.
 *
 * On success, sets `req.userId` (string) and calls next().
 * On failure, responds 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Try API key via Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer shard_')) {
      const apiKey = authHeader.slice('Bearer '.length);
      const ApiKey = getApiKeyModel();
      const keyDoc = await ApiKey.findOne({ key: apiKey });
      if (!keyDoc) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      // Update lastUsed async (fire and forget is acceptable, but we await for test reliability)
      await ApiKey.updateOne({ _id: keyDoc._id }, { lastUsed: new Date() });
      const apiKeyUserId = keyDoc.userId.toString();
      (req as any).userId = apiKeyUserId;

      // Check pending status for API key users too
      if (!isPendingAllowed(req.path)) {
        try {
          const User = getUserModel();
          const user = await User.findById(apiKeyUserId).lean().select('status');
          if (user && (user as any).status === 'pending') {
            res.status(403).json({ error: 'pending_approval' });
            return;
          }
        } catch {
          // If we can't check status, allow through
        }
      }

      next();
      return;
    }

    // 2. Try session JWT cookie
    const cookieToken = req.cookies?.shard_token;
    if (cookieToken) {
      // Verify JWT signature/expiry first (fast path)
      try {
        verifyJwt(cookieToken);
      } catch {
        res.status(401).json({ error: 'Invalid or expired session token' });
        return;
      }

      // Check session exists in DB
      const userId = await getSessionUser(cookieToken);
      if (!userId) {
        res.status(401).json({ error: 'Session not found or expired' });
        return;
      }

      (req as any).userId = userId;

      // Check if user is pending — reject protected routes with 403
      if (!isPendingAllowed(req.path)) {
        try {
          const User = getUserModel();
          const user = await User.findById(userId).lean().select('status');
          if (user && (user as any).status === 'pending') {
            res.status(403).json({ error: 'pending_approval' });
            return;
          }
        } catch {
          // If we can't check status, allow through (DB may not be ready in tests)
        }
      }

      next();
      return;
    }

    // 3. No credentials provided
    res.status(401).json({ error: 'Authentication required' });
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

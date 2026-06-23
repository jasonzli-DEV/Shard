import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { configurePassport } from './auth/passport';
import authRouter, { meHandler } from './routes/auth';
import apiKeysRouter from './routes/apiKeys';
import filesRouter from './routes/files';
import sharesRouter from './routes/shares';
import publicLinksRouter from './routes/publicLinks';
import v1Router from './routes/v1';
import storageRouter from './routes/storage';
import setupRouter from './routes/setup';
import adminRouter from './routes/admin';
import cronRouter from './routes/cron';
import { requireAuth } from './middleware/auth';
import { e2eAuthRouter } from './routes/e2eAuth';
import { getConfig, isConfigured } from './config/configService';
import { logger } from './utils/logger';

// Process-level error guards — log but never crash the server
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on('uncaughtException', (err: Error) => {
  logger.error('uncaughtException', { error: err.message, stack: err.stack });
});

export function createApp(): Application {
  const app = express();

  // ── Middleware ────────────────────────────────────────────────────────────
  // CORS is evaluated LIVE per request (not snapshotted) because on serverless
  // the app instance is cached across config changes. During setup (before the
  // instance is configured) all origins are allowed so the wizard — served from
  // the deployment's own domain — can reach /api/setup/*. A disallowed origin is
  // denied gracefully (no thrown error → no 500); the browser blocks it.
  app.use(
    cors({
      origin: (origin, cb) => {
        // No Origin header (server-to-server, curl, same-origin) → allow.
        if (!origin) return cb(null, true);

        const cfg = getConfig();
        const list = [
          ...(cfg.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
          ...(cfg.publicUrl ? [cfg.publicUrl.trim()] : []),
          ...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL.trim()] : []),
          ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
        ];

        // Before setup is complete, allow any origin so the wizard works.
        if (!isConfigured() || list.includes(origin)) return cb(null, true);

        // Disallowed origin: deny without throwing (avoids a 500).
        return cb(null, false);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ── Passport ──────────────────────────────────────────────────────────────
  configurePassport();
  app.use(passport.initialize());

  // ── Routes ────────────────────────────────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Setup wizard — must be before auth routes (setup doesn't require auth)
  app.use('/api/setup', setupRouter);

  // E2E-only test auth — STRICTLY guarded behind SHARD_E2E=1; never active in production
  if (process.env.SHARD_E2E === '1') {
    app.use('/api/e2e', e2eAuthRouter);
  }

  app.use('/api/auth', authRouter);
  app.get('/api/me', requireAuth, meHandler);
  app.use('/api/admin', adminRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/keys', apiKeysRouter);
  // publicLinksRouter must be mounted BEFORE filesRouter because filesRouter
  // applies requireAuth globally and would intercept /api/public/:slug requests.
  app.use('/api', publicLinksRouter);
  app.use('/api', filesRouter);
  app.use('/api', sharesRouter);
  app.use('/api', storageRouter);
  app.use('/api/v1', v1Router);

  // ── Error handler ─────────────────────────────────────────────────────────
  // Return a generic message in production to avoid leaking driver internals.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const { logger: appLogger } = require('./utils/logger') as typeof import('./utils/logger');
    appLogger.error('Unhandled error', { error: err.message, stack: err.stack });
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
  });

  return app;
}

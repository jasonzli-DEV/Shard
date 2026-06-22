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
import { requireAuth } from './middleware/auth';
import { e2eAuthRouter } from './routes/e2eAuth';

export function createApp(): Application {
  const app = express();

  // ── Middleware ────────────────────────────────────────────────────────────
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow requests with no origin (server-to-server, curl, Postman)
        if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error(`CORS: origin "${origin}" not allowed`));
        }
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
  app.use('/api/keys', apiKeysRouter);
  // publicLinksRouter must be mounted BEFORE filesRouter because filesRouter
  // applies requireAuth globally and would intercept /api/public/:slug requests.
  app.use('/api', publicLinksRouter);
  app.use('/api', filesRouter);
  app.use('/api', sharesRouter);
  app.use('/api', storageRouter);
  app.use('/api/v1', v1Router);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

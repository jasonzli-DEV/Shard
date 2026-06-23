/**
 * Vercel serverless entry point.
 *
 * Exports the Express app as a handler WITHOUT calling app.listen().
 * DB and config are initialized lazily per cold start, guarded by the
 * cached connection so they run at most once per warm invocation.
 *
 * For Docker/Pi, use backend/src/index.ts (which calls app.listen).
 */

import { createApp } from '../backend/src/app';
import { connectRuntime } from '../backend/src/lib/runtime';
import { loadConfig } from '../backend/src/config/configService';
import { configurePassport } from '../backend/src/auth/passport';
import { logger } from '../backend/src/utils/logger';

// Mark as serverless so startStorageLoops() skips background intervals
process.env.SERVERLESS = '1';

let initialized = false;
let initPromise: Promise<void> | null = null;

async function initialize(): Promise<void> {
  if (initialized) return;

  const starterUri = process.env.STARTER_MONGODB_URI;
  if (starterUri) {
    try {
      await connectRuntime(starterUri);
      await loadConfig();
      // createApp() configured passport before DB config was loaded (empty OAuth);
      // re-run it now that loadConfig() has hydrated the DB config so the OAuth
      // strategies are registered on every cold start.
      configurePassport();
      initialized = true;
    } catch (err) {
      logger.error('Serverless init error', { error: (err as Error).message });
      // Don't throw — setup wizard still needs to be reachable
    }
  }
}

// Create the app once (cached across warm invocations)
const app = createApp();

// Vercel expects a default export of a request handler
export default async function handler(req: any, res: any): Promise<void> {
  // Lazy initialization — runs once per cold start
  if (!initPromise) {
    initPromise = initialize();
  }
  await initPromise;

  return new Promise((resolve, reject) => {
    app(req, res, (err?: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

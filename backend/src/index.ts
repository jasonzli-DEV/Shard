import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { createApp } from './app';
import { connectStarter } from './lib/db';
import { logger } from './utils/logger';
import { startStorageLoops } from './storage/scheduler';
import { openCluster } from './storage/clusterManager';
import { StorageClusterModel } from './models';

// Load values persisted by the setup wizard (written to SETUP_ENV_FILE_PATH,
// a mounted volume) so configuration survives container restarts. These
// override the base .env baked in via env_file, since the wizard is the
// source of truth once setup has run.
const SETUP_ENV_FILE_PATH =
  process.env.SETUP_ENV_FILE_PATH ?? `${process.cwd()}/config/.env`;
if (fs.existsSync(SETUP_ENV_FILE_PATH)) {
  dotenv.config({ path: SETUP_ENV_FILE_PATH, override: true });
  logger.info(`Loaded persisted setup config from ${SETUP_ENV_FILE_PATH}`);
}

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const STARTER_URI = process.env.STARTER_MONGODB_URI;

async function rehydrateStorageClusters(): Promise<void> {
  try {
    // Load all non-decommissioned clusters from the DB and open their connections.
    // This ensures uploads/downloads work immediately after a restart/redeploy.
    const clusters = await StorageClusterModel.find({
      status: { $ne: 'decommissioned' },
    });

    logger.info(`Rehydrating ${clusters.length} storage cluster connection(s)…`);

    const results = await Promise.allSettled(
      clusters.map((c) =>
        openCluster({
          clusterId: c.clusterId,
          connectionUri: c.connectionUri,
          userId: c.userId.toString(),
          status: c.status,
        }),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn(
        `${failed.length} cluster(s) failed to open at startup (will retry on demand):`,
        failed.map((r) => (r as PromiseRejectedResult).reason?.message),
      );
    }

    const ok = results.length - failed.length;
    logger.info(`Storage cluster rehydration complete: ${ok} ok, ${failed.length} failed`);
  } catch (err) {
    // Non-fatal: lazy-open (getOrOpenBucket) handles individual reconnections
    logger.warn('Storage cluster rehydration error (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  // Setup mode: when no starter cluster is configured yet, boot anyway so the
  // web setup wizard (/api/setup/*) and health check are reachable. The user
  // completes the wizard (which persists config to SETUP_ENV_FILE_PATH), then
  // restarts the container — on reboot STARTER_URI is loaded and the app
  // connects normally. DB-dependent routes are not exercised until then
  // because the frontend redirects to /setup while setup is required.
  if (!STARTER_URI) {
    logger.warn(
      'STARTER_MONGODB_URI not set — starting in SETUP MODE. ' +
        'Complete the setup wizard in the browser, then restart the container.',
    );
    const app = createApp();
    app.listen(PORT, () => {
      logger.info(`Shard backend listening on port ${PORT} (setup mode)`);
    });
    return;
  }

  // Connect isolated named connection (used by auth/session/storage routes)
  await connectStarter(STARTER_URI);

  // Also connect the default mongoose connection so that models using
  // mongoose.model() (e.g. FileModel) can reach the same database.
  await mongoose.connect(STARTER_URI);

  // Rehydrate storage cluster connections so existing uploads/downloads work
  // immediately after a restart or redeploy (C1 fix).
  await rehydrateStorageClusters();

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`Shard backend listening on port ${PORT}`);
  });

  // Start background storage loops only when not in test mode
  if (process.env.NODE_ENV !== 'test') {
    startStorageLoops();
    logger.info('Storage background loops started');
  }
}

main().catch((err: Error) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});

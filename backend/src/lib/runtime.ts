import mongoose from 'mongoose';
import { connectStarter } from './db';
import { logger } from '../utils/logger';
import { startStorageLoops } from '../storage/scheduler';
import { openCluster } from '../storage/clusterManager';
import { StorageClusterModel } from '../models';

let runtimeStarted = false;

export function isRuntimeStarted(): boolean {
  return runtimeStarted;
}

/**
 * Open connections for every registered (non-decommissioned) storage cluster so
 * uploads/downloads work immediately after a restart or redeploy. Best-effort:
 * individual failures are non-fatal because getOrOpenBucket() lazily reconnects.
 */
async function rehydrateStorageClusters(): Promise<void> {
  try {
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
    logger.info(
      `Storage cluster rehydration complete: ${results.length - failed.length} ok, ${failed.length} failed`,
    );
  } catch (err) {
    logger.warn('Storage cluster rehydration error (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Bring the full Shard runtime online against the starter cluster: connect the
 * named + default mongoose connections, rehydrate storage clusters, and start
 * the background storage loops. Idempotent — safe to call from both server boot
 * AND the setup wizard's /configure handler (so completing setup activates the
 * app live, with no container restart).
 */
export async function connectRuntime(uri: string): Promise<void> {
  if (runtimeStarted) return;

  // Named connection (auth/session/file/storage routes resolve it via getStarter()).
  await connectStarter(uri);
  // Default connection for models that use mongoose.model() (e.g. FileModel).
  await mongoose.connect(uri);

  await rehydrateStorageClusters();

  runtimeStarted = true;

  // Background loops are pointless under the test runner (and would leak timers).
  if (process.env.NODE_ENV !== 'test') {
    startStorageLoops();
    logger.info('Storage background loops started');
  }

  logger.info('Shard runtime connected');
}

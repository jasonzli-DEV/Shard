import { StorageClusterModel } from '../models';
import { runStorageCheck, keepalive } from './clusterManager';
import { provisionNextCluster } from './provisioner';
import { decommissionEmptyClusters } from './decommission';

const STORAGE_CHECK_MS = 10 * 60_000; // 10 minutes
const KEEPALIVE_MS = 60_000; // 60 seconds
const EMPTY_SWEEP_MS = 30 * 60_000; // 30 minutes

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let storageCheckInterval: ReturnType<typeof setInterval> | null = null;
let emptySweepInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Run storage check + provisioning for all registered users.
 * Exported for use by cron endpoints (Workstream B).
 */
export async function runStorageCheckAllUsers(): Promise<void> {
  // Find all unique userIds with clusters (any status)
  let clusters: Array<{ userId: { toString(): string }; clusterId: string; status: string }>;
  try {
    clusters = await StorageClusterModel.find({}).lean();
  } catch {
    clusters = [];
  }

  // Deduplicate userIds
  const userIds = [...new Set(clusters.map((c) => c.userId.toString()))];

  for (const userId of userIds) {
    try {
      const result = await runStorageCheck(userId);
      if (result.checked && result.atThreshold) {
        await provisionNextCluster(userId);
      }
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === 'STORAGE_FULL') {
        console.error(`[Scheduler] Storage full for user ${userId}: ${error.message}`);
      } else {
        console.error(`[Scheduler] Storage check failed for user ${userId}:`, error);
      }
    }
  }
}

/**
 * Run decommission sweep across all users.
 * Exported for use by cron endpoints (Workstream B).
 */
export async function runDecommissionSweep(): Promise<void> {
  // Find all unique userIds with any cluster
  let clusters: Array<{ userId: { toString(): string } }>;
  try {
    clusters = await StorageClusterModel.find({}).lean();
  } catch {
    clusters = [];
  }

  const userIds = [...new Set(clusters.map((c) => c.userId.toString()))];

  for (const userId of userIds) {
    try {
      await decommissionEmptyClusters(userId);
    } catch (err) {
      console.error(`[Scheduler] Empty sweep failed for user ${userId}:`, err);
    }
  }
}

/**
 * Start background storage loops.
 * Only runs when SERVERLESS !== '1' (i.e., not on Vercel).
 */
export function startStorageLoops(): void {
  // Gate: do not start loops in serverless environments
  if (process.env.SERVERLESS === '1') {
    console.log('[Scheduler] Serverless mode — background loops disabled (use cron endpoints)');
    return;
  }

  if (keepaliveInterval || storageCheckInterval || emptySweepInterval) {
    // Already running
    return;
  }

  keepaliveInterval = setInterval(() => {
    keepalive().catch((err: Error) =>
      console.error('[Scheduler] Keepalive failed:', err),
    );
  }, KEEPALIVE_MS);

  storageCheckInterval = setInterval(() => {
    runStorageCheckAllUsers().catch((err: Error) =>
      console.error('[Scheduler] Storage check loop failed:', err),
    );
  }, STORAGE_CHECK_MS);

  emptySweepInterval = setInterval(() => {
    runDecommissionSweep().catch((err: Error) =>
      console.error('[Scheduler] Empty sweep loop failed:', err),
    );
  }, EMPTY_SWEEP_MS);
}

export function stopStorageLoops(): void {
  if (keepaliveInterval !== null) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
  if (storageCheckInterval !== null) {
    clearInterval(storageCheckInterval);
    storageCheckInterval = null;
  }
  if (emptySweepInterval !== null) {
    clearInterval(emptySweepInterval);
    emptySweepInterval = null;
  }
}

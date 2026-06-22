import { StorageClusterModel } from '../models';
import { runStorageCheck, keepalive } from './clusterManager';
import { provisionNextCluster } from './provisioner';

const STORAGE_CHECK_MS = 10 * 60_000; // 10 minutes
const KEEPALIVE_MS = 60_000; // 60 seconds

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let storageCheckInterval: ReturnType<typeof setInterval> | null = null;

async function runStorageChecks(): Promise<void> {
  // Find all unique userIds with active clusters
  let activeClusters: Array<{ userId: { toString(): string }; clusterId: string; status: string }>;
  try {
    activeClusters = await StorageClusterModel.find({ status: 'active' }).lean();
  } catch {
    activeClusters = [];
  }

  // Deduplicate userIds
  const userIds = [...new Set(activeClusters.map((c) => c.userId.toString()))];

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

export function startStorageLoops(): void {
  if (keepaliveInterval || storageCheckInterval) {
    // Already running
    return;
  }

  keepaliveInterval = setInterval(() => {
    keepalive().catch((err: Error) =>
      console.error('[Scheduler] Keepalive failed:', err),
    );
  }, KEEPALIVE_MS);

  storageCheckInterval = setInterval(() => {
    runStorageChecks().catch((err: Error) =>
      console.error('[Scheduler] Storage check loop failed:', err),
    );
  }, STORAGE_CHECK_MS);
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
}

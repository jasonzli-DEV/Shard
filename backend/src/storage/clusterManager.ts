import mongoose from 'mongoose';
import { StorageClusterModel, type IStorageCluster } from '../models';
import { logger } from '../utils/logger';

/** Hard Atlas M0 limit per cluster */
export const STORAGE_LIMIT_BYTES = 512 * 1024 * 1024; // 512 MB
/** Safety margin below the hard limit to avoid Atlas throttling/blocking */
export const SAFETY_MARGIN_BYTES = 20 * 1024 * 1024; // 20 MB
/** Usable capacity per cluster for packing — synchronous upload path fills up to this */
export const USABLE_BYTES = STORAGE_LIMIT_BYTES - SAFETY_MARGIN_BYTES; // 492 MB
/** Pre-warm threshold: start provisioning the next cluster once active passes this fraction of USABLE_BYTES */
const PREWARM_THRESHOLD = 0.9;

interface ClusterEntry {
  clusterId: string;
  connectionUri: string;
  userId: string;
  status: IStorageCluster['status'];
}

interface ConnectionRecord {
  conn: mongoose.Connection;
}

// Keyed by clusterId
const connections = new Map<string, ConnectionRecord>();
// Keyed by clusterId
const gridFSBuckets = new Map<string, unknown>();

export async function openCluster(entry: ClusterEntry): Promise<void> {
  if (connections.has(entry.clusterId)) return;
  const conn = mongoose.createConnection(entry.connectionUri);
  await (conn as unknown as { asPromise(): Promise<void> }).asPromise();
  connections.set(entry.clusterId, { conn });
}

export function getBucket(clusterId: string): unknown | null {
  if (!gridFSBuckets.has(clusterId)) {
    const record = connections.get(clusterId);
    if (!record?.conn.db) return null;
    // Access GridFSBucket dynamically so tests can spy/mock it on mongoose.mongo
    const GridFSBucketCtor = mongoose.mongo.GridFSBucket;
    gridFSBuckets.set(
      clusterId,
      new GridFSBucketCtor(record.conn.db, { bucketName: 'shard-files' }),
    );
  }
  return gridFSBuckets.get(clusterId) ?? null;
}

/**
 * Lazily open a cluster connection on demand.
 * If the connection is already open this is a no-op.
 * Looks up the StorageCluster doc by clusterId to retrieve the URI.
 * Returns the bucket on success, null if the cluster doc is not found or
 * the connection cannot be opened (errors are logged, not rethrown).
 */
export async function getOrOpenBucket(clusterId: string): Promise<unknown | null> {
  // Fast path: already connected
  const fast = getBucket(clusterId);
  if (fast !== null) return fast;

  try {
    const clusterDoc = await StorageClusterModel.findOne({ clusterId });
    if (!clusterDoc) return null;

    await openCluster({
      clusterId: clusterDoc.clusterId,
      connectionUri: clusterDoc.connectionUri,
      userId: clusterDoc.userId.toString(),
      status: clusterDoc.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`clusterManager: failed to open cluster "${clusterId}" on demand`, { error: msg });
    return null;
  }

  return getBucket(clusterId);
}

export async function getActiveCluster(userId: string): Promise<IStorageCluster | null> {
  return StorageClusterModel.findOne({ userId, status: 'active' });
}

export interface StorageCheckResult {
  checked: boolean;
  clusterId?: string;
  usedBytes?: number;
  atThreshold?: boolean;
}

export async function runStorageCheck(userId: string): Promise<StorageCheckResult> {
  const cluster = await getActiveCluster(userId);
  if (!cluster) return { checked: false };

  const record = connections.get(cluster.clusterId);
  if (!record?.conn.db) return { checked: false };

  const stats = await (record.conn.db as unknown as { command(cmd: Record<string, unknown>): Promise<{ dataSize?: number; indexSize?: number }> }).command({ dbStats: 1 });
  const usedBytes = (stats.dataSize ?? 0) + (stats.indexSize ?? 0);

  await StorageClusterModel.findOneAndUpdate(
    { clusterId: cluster.clusterId },
    { storageUsedBytes: usedBytes, lastCheckedAt: new Date() },
    { new: true },
  ).catch(() => null);

  const atThreshold = usedBytes >= USABLE_BYTES * PREWARM_THRESHOLD;

  return {
    checked: true,
    clusterId: cluster.clusterId,
    usedBytes,
    atThreshold,
  };
}

export async function keepalive(): Promise<void> {
  const pingCmd = { ping: 1 };
  for (const { conn } of connections.values()) {
    await (conn.db as unknown as { command(cmd: Record<string, unknown>): Promise<unknown> } | undefined)
      ?.command(pingCmd)
      .catch(() => null);
  }
}

export async function closeCluster(clusterId: string): Promise<void> {
  const record = connections.get(clusterId);
  if (!record) return;
  await (record.conn as unknown as { close?(): Promise<void> }).close?.().catch(() => null);
  connections.delete(clusterId);
  gridFSBuckets.delete(clusterId);
}

export async function closeAll(): Promise<void> {
  for (const { conn } of connections.values()) {
    await (conn as unknown as { close?(): Promise<void> }).close?.().catch(() => null);
  }
  connections.clear();
  gridFSBuckets.clear();
}

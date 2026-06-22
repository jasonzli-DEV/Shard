import mongoose from 'mongoose';
import { StorageClusterModel, type IStorageCluster } from '../models';

const STORAGE_THRESHOLD = 0.8;

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

  const capacity = cluster.storageCapacityBytes ?? 512 * 1024 * 1024;
  const atThreshold = usedBytes >= capacity * STORAGE_THRESHOLD;

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

export async function closeAll(): Promise<void> {
  for (const { conn } of connections.values()) {
    await (conn as unknown as { close?(): Promise<void> }).close?.().catch(() => null);
  }
  connections.clear();
  gridFSBuckets.clear();
}

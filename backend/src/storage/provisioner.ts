import { nanoid } from 'nanoid';
import { Types } from 'mongoose';
import { OrgKeyModel, StorageClusterModel, type IStorageCluster } from '../models';
import { makeAtlasClient, M0_ELIGIBLE_REGIONS } from '../atlas/client';
import { openCluster, getActiveCluster, USABLE_BYTES } from './clusterManager';

const ORG_CLUSTER_CAP = 250;

/** Fallback Atlas region when neither OrgKey.region nor ATLAS_DEFAULT_REGION env var is set */
const FALLBACK_REGION = 'US_EAST_1';

class StorageFullError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'StorageFullError';
    this.code = 'STORAGE_FULL';
  }
}

export async function provisionNextCluster(userId: string): Promise<IStorageCluster> {
  // Find all org keys for this user
  const orgKeys = await OrgKeyModel.find({ userId: new Types.ObjectId(userId) });

  // Find one with capacity
  const orgKey = orgKeys.find((k) => k.clusterCount < ORG_CLUSTER_CAP);
  if (!orgKey) {
    const err = new StorageFullError(
      'No Atlas org key has remaining capacity. Add another org key or contact support.',
    );
    throw err;
  }

  const client = makeAtlasClient({
    publicKey: orgKey.publicKey,
    privateKey: orgKey.privateKey,
  });

  const nextIndex = orgKey.clusterCount + 1;
  const clusterName = `shard-${userId.slice(-8)}-${nextIndex}`;
  const projectName = clusterName;

  // Create Atlas project (with access list retry)
  const project = await client.withOrgApiAccessListRetry(orgKey.orgId, () =>
    client.createProject(orgKey.orgId, projectName),
  );
  const projectId = project.id;

  // Determine region: prefer OrgKey.region, then ATLAS_DEFAULT_REGION env var, then US_EAST_1
  const rawRegion =
    (orgKey as unknown as { region?: string }).region ??
    process.env['ATLAS_DEFAULT_REGION'] ??
    FALLBACK_REGION;
  if (!(M0_ELIGIBLE_REGIONS as readonly string[]).includes(rawRegion)) {
    throw new Error(
      `Invalid Atlas region "${rawRegion}". Must be one of: ${M0_ELIGIBLE_REGIONS.join(', ')}`,
    );
  }

  // Create cluster
  await client.createCluster(projectId, clusterName, rawRegion);

  // Wait for cluster to be IDLE
  const cluster = await client.waitForCluster(projectId, clusterName);

  const srvHost = (cluster.connectionStrings as { standardSrv?: string } | undefined)?.standardSrv ?? '';
  const dbName = 'shard';

  // Generate credentials
  const dbUser = `shard-${nanoid(12)}`;
  const dbPass = nanoid(32);

  await client.createDatabaseUser(projectId, dbUser, dbPass);
  await client.addIpAllowlist(projectId);

  const connectionUri = client.buildConnectionUri(srvHost, dbUser, dbPass, dbName);

  // Demote any prior active clusters for this user
  try {
    await StorageClusterModel.updateMany(
      { userId: new Types.ObjectId(userId), status: 'active' },
      { status: 'full' },
    );
  } catch {
    // Non-fatal: best-effort demote
  }

  // Save new StorageCluster
  const entry = await StorageClusterModel.create({
    userId: new Types.ObjectId(userId),
    orgKeyId: orgKey._id,
    clusterId: clusterName,
    projectId,
    clusterName,
    connectionUri,
    status: 'active' as const,
    storageUsedBytes: 0,
    storageCapacityBytes: 512 * 1024 * 1024,
  });

  // Increment clusterCount on the OrgKey
  await OrgKeyModel.findByIdAndUpdate(orgKey._id, { $inc: { clusterCount: 1 } });

  // Open connection in cluster manager (best-effort; may fail in tests)
  try {
    await openCluster({
      clusterId: clusterName,
      connectionUri,
      userId,
      status: 'active',
    });
  } catch {
    // Non-fatal
  }

  return entry;
}

export async function ensureCapacity(
  userId: string,
  neededBytes: number,
): Promise<IStorageCluster> {
  const active = await getActiveCluster(userId);

  if (active) {
    // Pack up to USABLE_BYTES — no percentage gate, just hard safety margin
    const free = USABLE_BYTES - active.storageUsedBytes;
    if (free >= neededBytes) {
      return active;
    }
  }

  // No cluster, or active cluster doesn't have USABLE_BYTES room for this upload
  return provisionNextCluster(userId);
}

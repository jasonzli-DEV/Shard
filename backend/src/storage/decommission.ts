import { Types } from 'mongoose';
import { OrgKeyModel, StorageClusterModel, BlobModel } from '../models';
import { makeAtlasClient } from '../atlas/client';
import { closeCluster } from './clusterManager';

/**
 * Decommissions empty, non-active clusters for a user.
 *
 * Rules:
 * - NEVER removes the user's last remaining cluster.
 * - NEVER removes the active cluster (status='active').
 * - NEVER removes a cluster that still has Blobs referencing it.
 * - For each eligible cluster: deleteCluster + deleteProject on Atlas,
 *   decrement OrgKey.clusterCount, delete StorageCluster record,
 *   close its connection in the cluster manager.
 */
export async function decommissionEmptyClusters(userId: string): Promise<void> {
  const allClusters = await StorageClusterModel.find({ userId: new Types.ObjectId(userId) });

  // Must keep at least one cluster; never decommission if user has only one
  if (allClusters.length <= 1) return;

  for (const cluster of allClusters) {
    // Never decommission the active cluster
    if (cluster.status === 'active') continue;

    // Check if any Blobs reference this cluster
    const hasBlobs = await BlobModel.exists({ clusterId: cluster._id });
    if (hasBlobs) continue;

    // Re-check that decommissioning this cluster won't leave the user with zero clusters
    const remainingCount = await StorageClusterModel.countDocuments({
      userId: new Types.ObjectId(userId),
      _id: { $ne: cluster._id },
    }).catch(() => null);
    if (remainingCount === null || remainingCount < 1) continue;

    // Load the owning OrgKey to get Atlas credentials
    const orgKey = await OrgKeyModel.findById(cluster.orgKeyId).catch(() => null);
    if (!orgKey) continue;

    const client = makeAtlasClient({
      publicKey: orgKey.publicKey,
      privateKey: orgKey.privateKey,
    });

    // Delete cluster then project on Atlas (best-effort — log errors but keep cleaning up)
    try {
      await client.deleteCluster(cluster.projectId, cluster.clusterName);
    } catch (err) {
      console.error(
        `[Decommission] Failed to delete Atlas cluster ${cluster.clusterName}:`,
        err,
      );
    }

    try {
      await client.deleteProject(cluster.projectId);
    } catch (err) {
      console.error(
        `[Decommission] Failed to delete Atlas project ${cluster.projectId}:`,
        err,
      );
    }

    // Decrement the OrgKey's cluster count
    await OrgKeyModel.findByIdAndUpdate(cluster.orgKeyId, { $inc: { clusterCount: -1 } }).catch(
      (err) => console.error('[Decommission] Failed to decrement clusterCount:', err),
    );

    // Remove the StorageCluster record
    await StorageClusterModel.deleteOne({ _id: cluster._id }).catch((err) =>
      console.error('[Decommission] Failed to delete StorageCluster record:', err),
    );

    // Close the connection in the cluster manager
    await closeCluster(cluster.clusterId).catch((err) =>
      console.error('[Decommission] Failed to close cluster connection:', err),
    );
  }
}

import { Schema, model, Document, Types } from 'mongoose';

export type ClusterStatus = 'provisioning' | 'active' | 'full' | 'error' | 'decommissioned';

export interface IStorageCluster extends Document {
  userId: Types.ObjectId;
  orgKeyId: Types.ObjectId;
  /** Atlas cluster ID */
  clusterId: string;
  /** Atlas project ID */
  projectId: string;
  clusterName: string;
  /** mongodb+srv connection URI — stored plaintext intentionally */
  connectionUri: string;
  status: ClusterStatus;
  storageUsedBytes: number;
  /** 512 MB per M0 cluster */
  storageCapacityBytes: number;
  lastCheckedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StorageClusterSchema = new Schema<IStorageCluster>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orgKeyId: { type: Schema.Types.ObjectId, ref: 'OrgKey', required: true },
    clusterId: { type: String, required: true },
    projectId: { type: String, required: true },
    clusterName: { type: String, required: true },
    connectionUri: { type: String, required: true },
    status: {
      type: String,
      enum: ['provisioning', 'active', 'full', 'error', 'decommissioned'],
      default: 'provisioning',
    },
    storageUsedBytes: { type: Number, default: 0 },
    storageCapacityBytes: { type: Number, default: 512 * 1024 * 1024 }, // 512 MB
    lastCheckedAt: { type: Date },
  },
  { timestamps: true }
);

StorageClusterSchema.index({ userId: 1, status: 1 });
StorageClusterSchema.index({ clusterId: 1 }, { unique: true, name: 'clusterId_unique' });

export const StorageClusterModel = model<IStorageCluster>('StorageCluster', StorageClusterSchema);

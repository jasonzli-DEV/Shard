import { Schema, model, Document, Types } from 'mongoose';

/**
 * A Blob represents one GridFS chunk of a File, stored on a specific
 * StorageCluster. Files may span multiple clusters; blobs are ordered by index.
 */
export interface IBlob extends Document {
  fileId: Types.ObjectId;
  clusterId: Types.ObjectId;
  /** GridFS ObjectId on the target cluster */
  gridfsId: Types.ObjectId;
  /** Zero-based order for multi-cluster files */
  index: number;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

const BlobSchema = new Schema<IBlob>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    clusterId: { type: Schema.Types.ObjectId, ref: 'StorageCluster', required: true },
    gridfsId: { type: Schema.Types.ObjectId, required: true },
    index: { type: Number, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

// Each file can only have one blob per index position
BlobSchema.index({ fileId: 1, index: 1 }, { unique: true, name: 'fileId_index_unique' });
BlobSchema.index({ clusterId: 1 });

export const BlobModel = model<IBlob>('Blob', BlobSchema);

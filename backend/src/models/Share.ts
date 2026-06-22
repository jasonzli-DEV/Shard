import { Schema, model, Document, Types } from 'mongoose';

export type SharePermission = 'view' | 'edit';

export interface IShare extends Document {
  fileId: Types.ObjectId;
  sharedWithId: Types.ObjectId;
  permission: SharePermission;
  createdAt: Date;
  updatedAt: Date;
}

const ShareSchema = new Schema<IShare>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    sharedWithId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: ['view', 'edit'], required: true },
  },
  { timestamps: true }
);

// A file can only be shared once per recipient
ShareSchema.index({ fileId: 1, sharedWithId: 1 }, { unique: true, name: 'fileId_sharedWithId_unique' });
ShareSchema.index({ sharedWithId: 1 });

export const ShareModel = model<IShare>('Share', ShareSchema);

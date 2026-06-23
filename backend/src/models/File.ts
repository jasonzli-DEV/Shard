import { Schema, model, Document, Types } from 'mongoose';

export type FileType = 'file' | 'folder';

export interface IFile extends Document {
  userId: Types.ObjectId;
  parentId?: Types.ObjectId | null;
  name: string;
  /** Full path from root, e.g. "/documents/photo.jpg" */
  path: string;
  mimeType: string;
  size: number;
  type: FileType;
  starred: boolean;
  encrypted: boolean;
  /** True while a chunked upload is in progress; false once complete (or not applicable). */
  uploading: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<IFile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    name: { type: String, required: true },
    path: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, default: 0 },
    type: { type: String, enum: ['file', 'folder'], required: true },
    starred: { type: Boolean, default: false },
    encrypted: { type: Boolean, default: false },
    uploading: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Each user has a unique path namespace
FileSchema.index({ userId: 1, path: 1 }, { unique: true, name: 'userId_path_unique' });
FileSchema.index({ userId: 1, parentId: 1 });
FileSchema.index({ userId: 1, deletedAt: 1 });

export const FileModel = model<IFile>('File', FileSchema);

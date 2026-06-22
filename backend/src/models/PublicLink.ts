import { Schema, model, Document, Types } from 'mongoose';

export interface IPublicLink extends Document {
  fileId: Types.ObjectId;
  /** URL-safe slug, e.g. nanoid(12) */
  slug: string;
  createdBy: Types.ObjectId;
  expiresAt: Date;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const PublicLinkSchema = new Schema<IPublicLink>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    slug: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    downloadCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PublicLinkSchema.index({ slug: 1 }, { unique: true, name: 'publicLink_slug_unique' });
PublicLinkSchema.index({ fileId: 1 });
PublicLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PublicLinkModel = model<IPublicLink>('PublicLink', PublicLinkSchema);

import { Schema, model, Document, Types } from 'mongoose';

export interface IOrgKey extends Document {
  userId: Types.ObjectId;
  label: string;
  publicKey: string;
  /** Stored plaintext intentionally — keeps setup trivial */
  privateKey: string;
  orgId: string;
  clusterCount: number;
  /** Optional per-org Atlas region override (e.g. "EU_WEST_1"). Falls back to ATLAS_DEFAULT_REGION env var. */
  region?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrgKeySchema = new Schema<IOrgKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, required: true },
    publicKey: { type: String, required: true },
    /** Atlas API private key — intentionally stored plaintext */
    privateKey: { type: String, required: true },
    orgId: { type: String, required: true },
    clusterCount: { type: Number, default: 0 },
    region: { type: String },
  },
  { timestamps: true }
);

OrgKeySchema.index({ userId: 1 });

export const OrgKeyModel = model<IOrgKey>('OrgKey', OrgKeySchema);

import { Schema, model, Document, Types } from 'mongoose';

export interface IOrgKey extends Document {
  userId: Types.ObjectId;
  label: string;
  publicKey: string;
  /** Stored plaintext intentionally — keeps setup trivial */
  privateKey: string;
  orgId: string;
  clusterCount: number;
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
  },
  { timestamps: true }
);

OrgKeySchema.index({ userId: 1 });

export const OrgKeyModel = model<IOrgKey>('OrgKey', OrgKeySchema);

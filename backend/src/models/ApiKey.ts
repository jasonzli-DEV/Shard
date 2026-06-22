import { Schema, model, Document, Types } from 'mongoose';

export interface IApiKey extends Document {
  userId: Types.ObjectId;
  /** Full key value: "shard_" + nanoid(40) */
  key: string;
  label: string;
  lastUsed: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    lastUsed: { type: Date, default: null },
  },
  { timestamps: true }
);

ApiKeySchema.index({ key: 1 }, { unique: true, name: 'apiKey_key_unique' });
ApiKeySchema.index({ userId: 1 });

export const ApiKeyModel = model<IApiKey>('ApiKey', ApiKeySchema);

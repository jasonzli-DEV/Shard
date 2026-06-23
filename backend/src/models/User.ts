import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: 'admin' | 'user';
  status: 'active' | 'pending';
  encryptionEnabled: boolean;
  encryptionKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    provider: { type: String, enum: ['google', 'github'], required: true },
    providerId: { type: String, required: true },
    email: { type: String, required: true },
    displayName: { type: String, required: true },
    avatarUrl: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    status: { type: String, enum: ['active', 'pending'], default: 'pending' },
    encryptionEnabled: { type: Boolean, default: false },
    encryptionKey: { type: String },
  },
  { timestamps: true }
);

// Unique per OAuth provider
UserSchema.index({ provider: 1, providerId: 1 }, { unique: true, name: 'provider_providerId_unique' });
UserSchema.index({ email: 1 });

export const UserModel = model<IUser>('User', UserSchema);

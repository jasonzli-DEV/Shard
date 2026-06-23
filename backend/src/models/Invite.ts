import { Schema, model, Document, Types } from 'mongoose';

export interface IInvite extends Document {
  email: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

export const InviteModel = model<IInvite>('Invite', InviteSchema);

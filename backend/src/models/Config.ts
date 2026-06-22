import { Schema, model, Document } from 'mongoose';

export interface IConfig extends Document {
  key: 'singleton';
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  publicUrl?: string;
  allowedOrigins?: string;
  jwtSecret: string;
  updatedAt: Date;
}

const ConfigSchema = new Schema<IConfig>(
  {
    key: { type: String, default: 'singleton', required: true },
    googleClientId: { type: String },
    googleClientSecret: { type: String },
    githubClientId: { type: String },
    githubClientSecret: { type: String },
    publicUrl: { type: String },
    allowedOrigins: { type: String },
    jwtSecret: { type: String, required: true },
  },
  { timestamps: true }
);

ConfigSchema.index({ key: 1 }, { unique: true, name: 'config_key_unique' });

export const ConfigModel = model<IConfig>('Config', ConfigSchema);

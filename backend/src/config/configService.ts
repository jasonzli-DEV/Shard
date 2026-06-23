import crypto from 'crypto';
import { ConfigModel, type IConfig } from '../models/Config';
import { getStarter } from '../lib/db';
import mongoose from 'mongoose';

export interface AppConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  publicUrl?: string;
  allowedOrigins?: string;
  jwtSecret: string;
}

// Module-level cache — populated by loadConfig(), refreshed by saveConfig().
// null = never loaded; object = loaded (may have empty optional fields).
let _cache: Partial<AppConfig> | null = null;

/** For tests only: clear the in-memory cache. */
export function resetConfigCache(): void {
  _cache = null;
}

function getConfigModel(): mongoose.Model<IConfig> {
  const conn = getStarter();
  try {
    return conn.model<IConfig>(ConfigModel.modelName);
  } catch {
    return conn.model<IConfig>(ConfigModel.modelName, ConfigModel.schema);
  }
}

/**
 * Load the singleton from the DB into the in-memory cache.
 * If no document exists, creates one with a generated jwtSecret.
 * Requires the starter connection to be open (call after connectStarter).
 */
export async function loadConfig(): Promise<void> {
  const Config = getConfigModel();
  let doc = await Config.findOne({ key: 'singleton' });

  if (!doc) {
    const jwtSecret =
      process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex');
    doc = await Config.create({ key: 'singleton', jwtSecret });
  }

  _cache = docToCache(doc);
}

/**
 * Sync accessor over the in-memory cache.
 * For each field, falls back to the matching process.env value when the
 * cached/DB value is absent. Safe to call before loadConfig() — returns
 * only env-based values in that case.
 */
export function getConfig(): AppConfig {
  const c = _cache ?? {};

  const googleClientId = c.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = c.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const githubClientId = c.githubClientId || process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = c.githubClientSecret || process.env.GITHUB_CLIENT_SECRET;
  const publicUrl = c.publicUrl || process.env.PUBLIC_URL;
  const allowedOrigins = c.allowedOrigins || process.env.ALLOWED_ORIGINS;
  const jwtSecret =
    c.jwtSecret || process.env.JWT_SECRET || '';

  return {
    googleClientId,
    googleClientSecret,
    githubClientId,
    githubClientSecret,
    publicUrl,
    allowedOrigins,
    jwtSecret,
  };
}

/**
 * Upsert the singleton document with the given patch, refreshing the cache.
 * Auto-generates jwtSecret if it is still missing after the merge.
 */
export async function saveConfig(
  patch: Partial<Omit<AppConfig, 'jwtSecret'>> & { jwtSecret?: string }
): Promise<void> {
  const Config = getConfigModel();

  // Merge patch with current cache to avoid overwriting unrelated fields
  const current = _cache ?? {};
  const merged: Partial<AppConfig> = { ...current, ...patch };

  if (!merged.jwtSecret) {
    merged.jwtSecret = crypto.randomBytes(32).toString('hex');
  }

  const doc = await Config.findOneAndUpdate(
    { key: 'singleton' },
    {
      $set: {
        googleClientId: merged.googleClientId,
        googleClientSecret: merged.googleClientSecret,
        githubClientId: merged.githubClientId,
        githubClientSecret: merged.githubClientSecret,
        publicUrl: merged.publicUrl,
        allowedOrigins: merged.allowedOrigins,
        jwtSecret: merged.jwtSecret,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  _cache = docToCache(doc!);
}

/** true iff both Google client ID and secret are available via DB or env. */
export function hasGoogle(): boolean {
  const cfg = getConfig();
  return !!(cfg.googleClientId && cfg.googleClientSecret);
}

/** true iff both GitHub client ID and secret are available via DB or env. */
export function hasGithub(): boolean {
  const cfg = getConfig();
  return !!(cfg.githubClientId && cfg.githubClientSecret);
}

/**
 * true iff STARTER_MONGODB_URI is set in process.env AND at least one
 * OAuth provider is available via getConfig(). This is the canonical
 * "setup is complete" check.
 */
export function isConfigured(): boolean {
  const hasDb = !!process.env.STARTER_MONGODB_URI;
  return hasDb && (hasGoogle() || hasGithub());
}

// ── Private helpers ──────────────────────────────────────────────────────────

function docToCache(doc: IConfig): Partial<AppConfig> {
  return {
    googleClientId: doc.googleClientId,
    googleClientSecret: doc.googleClientSecret,
    githubClientId: doc.githubClientId,
    githubClientSecret: doc.githubClientSecret,
    publicUrl: doc.publicUrl,
    allowedOrigins: doc.allowedOrigins,
    jwtSecret: doc.jwtSecret,
  };
}

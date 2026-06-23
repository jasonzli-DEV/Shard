import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

// We must set the starter connection before importing configService
// because getStarter() is called lazily inside functions, not at import time.
// We'll mock getStarter() via jest module mock.
jest.mock('../../lib/db', () => ({
  getStarter: jest.fn(),
}));

import { getStarter } from '../../lib/db';
import {
  loadConfig,
  getConfig,
  saveConfig,
  hasGoogle,
  hasGithub,
  isConfigured,
  resetConfigCache,
} from '../configService';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  (getStarter as jest.Mock).mockReturnValue(conn);
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

beforeEach(async () => {
  resetConfigCache();
  // Clear relevant env vars
  [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
    'PUBLIC_URL', 'ALLOWED_ORIGINS', 'JWT_SECRET',
    'STARTER_MONGODB_URI',
  ].forEach((k) => delete process.env[k]);
  // Drop the Config collection so each test starts with a clean DB state.
  // Using dropCollection (not deleteMany) avoids stale index state.
  if (conn.db) {
    const collections = await conn.db.listCollections({ name: 'configs' }).toArray();
    if (collections.length > 0) {
      await conn.db.dropCollection('configs');
    }
  }
});

describe('loadConfig', () => {
  it('creates a singleton with generated jwtSecret if DB is empty', async () => {
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.jwtSecret).toBeTruthy();
    expect(cfg.jwtSecret.length).toBe(64); // 32 bytes hex
  });

  it('loads existing config from DB on second call (uses cache on third)', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    resetConfigCache();
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('gid');
  });
});

describe('getConfig — env fallback', () => {
  it('returns process.env.GOOGLE_CLIENT_ID when DB has no value', async () => {
    await loadConfig(); // empty DB → only jwtSecret
    process.env.GOOGLE_CLIENT_ID = 'env-gid';
    process.env.GOOGLE_CLIENT_SECRET = 'env-gsecret';
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('env-gid');
    expect(cfg.googleClientSecret).toBe('env-gsecret');
  });

  it('DB value takes precedence over process.env', async () => {
    await saveConfig({ googleClientId: 'db-gid', googleClientSecret: 'db-gsecret' });
    process.env.GOOGLE_CLIENT_ID = 'env-gid'; // should be ignored
    resetConfigCache();
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('db-gid');
  });

  it('falls back JWT_SECRET from env when DB has none', async () => {
    process.env.JWT_SECRET = 'env-jwt-secret';
    // loadConfig with no DB doc — but wait, loadConfig creates one with a
    // generated secret. So let's test getConfig() before loadConfig() is called.
    // getConfig() on fresh cache should still work (returns empty + env fallbacks).
    const cfg = getConfig(); // cache not loaded yet
    expect(cfg.jwtSecret).toBe('env-jwt-secret');
  });
});

describe('saveConfig', () => {
  it('persists to DB and refreshes cache', async () => {
    await saveConfig({ githubClientId: 'gh-id', githubClientSecret: 'gh-sec' });
    const cfg = getConfig();
    expect(cfg.githubClientId).toBe('gh-id');
  });

  it('auto-generates jwtSecret when not provided', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    const cfg = getConfig();
    expect(cfg.jwtSecret).toHaveLength(64);
  });

  it('preserves existing jwtSecret on partial update', async () => {
    await saveConfig({ jwtSecret: 'fixed-secret-32-chars-padded-here' });
    const first = getConfig().jwtSecret;
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    expect(getConfig().jwtSecret).toBe(first);
  });
});

describe('hasGoogle / hasGithub / isConfigured', () => {
  it('hasGoogle returns false when credentials absent', async () => {
    await loadConfig();
    expect(hasGoogle()).toBe(false);
  });

  it('hasGoogle returns true when both google creds present via DB', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    expect(hasGoogle()).toBe(true);
  });

  it('hasGithub returns true when both github creds present via env', async () => {
    await loadConfig();
    process.env.GITHUB_CLIENT_ID = 'env-gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'env-gh-sec';
    expect(hasGithub()).toBe(true);
  });

  it('isConfigured returns false when STARTER_MONGODB_URI not set', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    // STARTER_MONGODB_URI is not set in this test
    expect(isConfigured()).toBe(false);
  });

  it('isConfigured returns true when STARTER_MONGODB_URI set + ≥1 OAuth provider', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    expect(isConfigured()).toBe(true);
  });
});

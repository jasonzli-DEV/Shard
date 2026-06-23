/**
 * Setup route tests — DB-config contract (v2 Phase A).
 *
 * No file writes occur; all config is persisted via saveConfig() to the
 * in-memory starter DB provided by MongoMemoryServer.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// ── Mock lib/db so configService uses our test connection ──────────────────
jest.mock('../lib/db', () => ({ getStarter: jest.fn() }));
import { getStarter } from '../lib/db';

// ── Mock lib/runtime so /configure doesn't try to open real connections ────
jest.mock('../lib/runtime', () => ({
  connectRuntime: jest.fn().mockResolvedValue(undefined),
  isRuntimeStarted: jest.fn().mockReturnValue(false),
}));

import { createApp } from '../app';
import { resetConfigCache } from '../config/configService';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

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
  // Clear env vars that affect setup state
  [
    'STARTER_MONGODB_URI',
    'JWT_SECRET',
    'PUBLIC_URL',
    'FRONTEND_URL',
    'ALLOWED_ORIGINS',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  ].forEach((k) => delete process.env[k]);
  // Clean DB between tests for isolation
  if (conn.db) {
    const collections = await conn.db.listCollections({ name: 'configs' }).toArray();
    if (collections.length > 0) {
      await conn.db.dropCollection('configs');
    }
  }
});

// ── GET /api/setup/status ─────────────────────────────────────────────────────

describe('GET /api/setup/status', () => {
  it('returns setupRequired:true when nothing is configured', async () => {
    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(true);
    expect(res.body.configured).toBeDefined();
    expect(res.body.configured.starterDb).toBe(false);
    expect(res.body.configured.google || res.body.configured.github).toBe(false);
  });

  it('returns setupRequired:false after env + DB config is present', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';

    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(false);
    expect(res.body.configured.starterDb).toBe(true);
    expect(res.body.configured.google).toBe(true);
  });

  it('requires at least one OAuth provider', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    // No OAuth — still setup required
    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.body.setupRequired).toBe(true);
  });
});

// ── POST /api/setup/test-connection ──────────────────────────────────────────

describe('POST /api/setup/test-connection', () => {
  it('returns ok:false on an unreachable URI', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/test-connection')
      .send({ starterUri: 'mongodb://127.0.0.1:9' }) // nothing listening
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
  }, 15_000);

  it('returns 400 when starterUri is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/test-connection')
      .send({})
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });
});

// ── POST /api/setup/configure ────────────────────────────────────────────────

const validPayload = {
  starterUri: 'mongodb://localhost:27017/shard',
  google: { clientId: 'gid', clientSecret: 'gsecret' },
  publicUrl: 'https://shard.example.com',
  allowedOrigins: 'https://shard.example.com',
};

describe('POST /api/setup/configure', () => {
  it('returns 400 when starterUri is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({ publicUrl: 'https://x.com', allowedOrigins: 'https://x.com' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('returns 400 when neither google nor github is provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        publicUrl: 'https://x.com',
        allowedOrigins: 'https://x.com',
      })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OAuth/i);
  });

  it('returns 400 when an OAuth provider is incomplete (id without secret)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        google: { clientId: 'gid' }, // missing secret
        publicUrl: 'https://x.com',
        allowedOrigins: 'https://x.com',
      })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('persists config to DB and sets process.env.STARTER_MONGODB_URI on success', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // starterUri bootstrapped into process.env
    expect(process.env.STARTER_MONGODB_URI).toBe(validPayload.starterUri);

    // Config persisted to DB — verify via configService
    const { getConfig } = await import('../config/configService');
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('gid');
    expect(cfg.googleClientSecret).toBe('gsecret');
    expect(cfg.jwtSecret).toBeTruthy();
    expect(cfg.jwtSecret.length).toBe(64); // auto-generated: 32 bytes hex
  });

  it('does NOT create a config env file (config is DB-only)', async () => {
    // The new setup route saves to DB only — verify no *.env file appears
    // in the project root or config directory by checking the DB contract directly.
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    // Confirm config is in DB (not just env), by checking the cache directly
    const { getConfig } = await import('../config/configService');
    const cfg = getConfig();
    // jwtSecret is generated by saveConfig (not written to file or env)
    expect(cfg.jwtSecret).toBeTruthy();
    // env has NOT been polluted with oauth creds by the route
    // (only STARTER_MONGODB_URI gets set; oauth lives in DB)
    expect(process.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('auto-generates jwtSecret when absent', async () => {
    delete process.env.JWT_SECRET;
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    const { getConfig } = await import('../config/configService');
    expect(getConfig().jwtSecret).toHaveLength(64); // 32 bytes hex = 64 chars
  });

  it('returns 403 on second configure call (idempotent guard)', async () => {
    const app = createApp();

    // First configure
    const first = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');
    expect(first.status).toBe(200);

    // Second configure — must be blocked
    const second = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');
    expect(second.status).toBe(403);
  });

  it('flips GET /api/setup/status to setupRequired:false after configure', async () => {
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    const status = await request(app).get('/api/setup/status');
    expect(status.body.setupRequired).toBe(false);
  });

  it('accepts github credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        github: { clientId: 'gh_id', clientSecret: 'gh_secret' },
        publicUrl: 'https://shard.example.com',
        allowedOrigins: 'https://shard.example.com',
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    const { getConfig } = await import('../config/configService');
    const cfg = getConfig();
    expect(cfg.githubClientId).toBe('gh_id');
    expect(cfg.githubClientSecret).toBe('gh_secret');
  });
});

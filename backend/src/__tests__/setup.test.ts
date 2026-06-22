import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ENV_FILE_PATH = path.join(__dirname, '../../.env.test-setup');

/**
 * Reset all env vars that the setup route manages and clean up any written
 * files so each test starts from a blank state.
 */
function clearSetupEnv() {
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

  if (fs.existsSync(ENV_FILE_PATH)) fs.unlinkSync(ENV_FILE_PATH);
}

// Override the env file path so tests don't write to the real project .env
beforeEach(() => {
  clearSetupEnv();
  process.env.SETUP_ENV_FILE_PATH = ENV_FILE_PATH;
});

afterEach(() => {
  clearSetupEnv();
  delete process.env.SETUP_ENV_FILE_PATH;
  if (fs.existsSync(ENV_FILE_PATH)) fs.unlinkSync(ENV_FILE_PATH);
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

  it('returns setupRequired:false after env vars are set', async () => {
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

  it('writes env vars and updates process.env on success', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Written to file
    expect(fs.existsSync(ENV_FILE_PATH)).toBe(true);
    const envContent = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    expect(envContent).toContain('STARTER_MONGODB_URI=');
    expect(envContent).toContain('GOOGLE_CLIENT_ID=gid');
    expect(envContent).toContain('JWT_SECRET=');

    // Live process.env updated
    expect(process.env.STARTER_MONGODB_URI).toBe(validPayload.starterUri);
    expect(process.env.GOOGLE_CLIENT_ID).toBe('gid');
    expect(process.env.JWT_SECRET).toBeTruthy();
  });

  it('auto-generates JWT_SECRET when absent', async () => {
    delete process.env.JWT_SECRET;
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(process.env.JWT_SECRET).toHaveLength(64); // 32 bytes hex = 64 chars
  });

  it('preserves an existing JWT_SECRET', async () => {
    const existing = 'aaaa'.repeat(16); // 64 char
    process.env.JWT_SECRET = existing;
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(process.env.JWT_SECRET).toBe(existing);
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
    expect(process.env.GITHUB_CLIENT_ID).toBe('gh_id');
    expect(process.env.GITHUB_CLIENT_SECRET).toBe('gh_secret');
  });
});

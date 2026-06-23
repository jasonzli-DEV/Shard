/**
 * Cron endpoint tests
 *
 * Tests: auth enforcement, calls maintenance functions, SERVERLESS gating
 */
import request from 'supertest';
import type { Application } from 'express';

process.env.JWT_SECRET = 'cron-test-jwt-secret-at-least-32!!';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CRON_SECRET = 'test-cron-secret-123';

// Mock scheduler functions
jest.mock('../../storage/scheduler', () => ({
  runStorageCheckAllUsers: jest.fn().mockResolvedValue(undefined),
  runDecommissionSweep: jest.fn().mockResolvedValue(undefined),
  startStorageLoops: jest.fn(),
  stopStorageLoops: jest.fn(),
}));

import { createApp } from '../../app';
import { runStorageCheckAllUsers, runDecommissionSweep } from '../../storage/scheduler';

describe('Cron endpoints', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── /api/cron/storage-check ──────────────────────────────────────────────────

  it('POST /api/cron/storage-check returns 401 without secret', async () => {
    const res = await request(app).post('/api/cron/storage-check');
    expect(res.status).toBe(401);
  });

  it('POST /api/cron/storage-check returns 401 with wrong secret', async () => {
    const res = await request(app)
      .post('/api/cron/storage-check')
      .set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
  });

  it('POST /api/cron/storage-check succeeds with correct Bearer secret', async () => {
    const res = await request(app)
      .post('/api/cron/storage-check')
      .set('Authorization', 'Bearer test-cron-secret-123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runStorageCheckAllUsers).toHaveBeenCalledTimes(1);
  });

  it('POST /api/cron/storage-check succeeds with x-cron-secret header', async () => {
    const res = await request(app)
      .post('/api/cron/storage-check')
      .set('x-cron-secret', 'test-cron-secret-123');
    expect(res.status).toBe(200);
    expect(runStorageCheckAllUsers).toHaveBeenCalledTimes(1);
  });

  // ── /api/cron/decommission ────────────────────────────────────────────────────

  it('POST /api/cron/decommission returns 401 without secret', async () => {
    const res = await request(app).post('/api/cron/decommission');
    expect(res.status).toBe(401);
  });

  it('POST /api/cron/decommission succeeds with correct secret', async () => {
    const res = await request(app)
      .post('/api/cron/decommission')
      .set('Authorization', 'Bearer test-cron-secret-123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runDecommissionSweep).toHaveBeenCalledTimes(1);
  });
});

describe('Cron endpoints without CRON_SECRET', () => {
  let app: Application;

  beforeAll(() => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    app = createApp();
    if (original) process.env.CRON_SECRET = original;
  });

  it('POST /api/cron/storage-check returns 204 when CRON_SECRET not configured', async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await request(app)
        .post('/api/cron/storage-check')
        .set('Authorization', 'Bearer anything');
      expect(res.status).toBe(204);
    } finally {
      if (saved) process.env.CRON_SECRET = saved;
    }
  });
});

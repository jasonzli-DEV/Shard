/**
 * Task 2.2 — requireAuth middleware tests
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import express, { Request, Response } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();

  const { setSessionConnection } = require('../../auth/sessions');
  setSessionConnection(conn);

  const { setPassportConnection } = require('../../auth/passport');
  setPassportConnection(conn);

  const { setAuthMiddlewareConnection } = require('../auth');
  setAuthMiddlewareConnection(conn);
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

import { requireAuth } from '../auth';
import { createSession } from '../../auth/sessions';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get('/protected', requireAuth, (req: Request, res: Response) => {
    res.json({ userId: (req as any).userId });
  });
  return app;
}

describe('requireAuth middleware', () => {
  let validToken: string;
  let userId: string;

  beforeAll(async () => {
    userId = new Types.ObjectId().toHexString();
    validToken = await createSession(userId);
  });

  it('rejects request with no auth (401)', async () => {
    const app = makeApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('accepts a valid session JWT in cookie', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Cookie', `shard_token=${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  it('rejects an invalid JWT cookie', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Cookie', 'shard_token=badtoken');
    expect(res.status).toBe(401);
  });

  it('accepts a valid API key via Authorization: Bearer header', async () => {
    // Create an API key in the DB
    const { ApiKeyModel } = require('../../models/ApiKey');
    const BoundApiKey = conn.model(ApiKeyModel.modelName, ApiKeyModel.schema);
    const apiKey = `shard_${'x'.repeat(40)}`;
    const keyUserId = new Types.ObjectId().toHexString();
    await BoundApiKey.create({
      userId: new Types.ObjectId(keyUserId),
      key: apiKey,
      label: 'test key',
    });

    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(keyUserId);
  });

  it('rejects an unknown API key', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer shard_unknownkey1234567890123456789012345678901234567890');
    expect(res.status).toBe(401);
  });

  it('updates ApiKey.lastUsed when API key is used', async () => {
    const { ApiKeyModel } = require('../../models/ApiKey');
    const BoundApiKey = conn.model(ApiKeyModel.modelName, ApiKeyModel.schema);
    const apiKey = `shard_${'y'.repeat(40)}`;
    const keyUserId = new Types.ObjectId().toHexString();
    await BoundApiKey.create({
      userId: new Types.ObjectId(keyUserId),
      key: apiKey,
      label: 'last used test',
      lastUsed: null,
    });

    const app = makeApp();
    await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${apiKey}`);

    const updated = await BoundApiKey.findOne({ key: apiKey });
    expect(updated?.lastUsed).not.toBeNull();
  });
});

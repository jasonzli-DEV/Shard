/**
 * Task 2.3 — API Keys routes tests (supertest)
 * GET/POST/DELETE /api/keys
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import type { Application } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';
process.env.PUBLIC_URL = 'http://localhost:4000';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();

  const { setSessionConnection } = require('../../auth/sessions');
  setSessionConnection(conn);

  const { setPassportConnection } = require('../../auth/passport');
  setPassportConnection(conn);

  const { setAuthMiddlewareConnection } = require('../../middleware/auth');
  setAuthMiddlewareConnection(conn);

  const { setAuthRoutesConnection } = require('../../routes/auth');
  setAuthRoutesConnection(conn);

  const { setApiKeysConnection } = require('../../routes/apiKeys');
  setApiKeysConnection(conn);
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';

describe('API Keys routes', () => {
  let app: Application;
  let sessionCookie: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();

    // Create a user and session
    const user = await upsertUserFromProfile({
      provider: 'github',
      id: 'apikeys-test-user',
      displayName: 'Key Tester',
      email: 'keys@test.com',
    });
    userId = user._id.toString();
    const token = await createSession(userId);
    sessionCookie = `shard_token=${token}`;
  });

  describe('POST /api/keys', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).post('/api/keys').send({ label: 'My Key' });
      expect(res.status).toBe(401);
    });

    it('creates a new API key with shard_ prefix', async () => {
      const res = await request(app)
        .post('/api/keys')
        .set('Cookie', sessionCookie)
        .send({ label: 'My Dev Key' });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^shard_/);
      expect(res.body.key.length).toBe(46); // 'shard_' (6) + nanoid(40)
      expect(res.body.label).toBe('My Dev Key');
    });

    it('returns 400 if label is missing', async () => {
      const res = await request(app)
        .post('/api/keys')
        .set('Cookie', sessionCookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/keys', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).get('/api/keys');
      expect(res.status).toBe(401);
    });

    it('lists keys for authenticated user (no full key returned)', async () => {
      const res = await request(app)
        .get('/api/keys')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Keys should not include full key, only keyHint
      for (const k of res.body) {
        expect(k.key).toBeUndefined();
        expect(k.keyHint).toMatch(/^shard_\.\.\./);
      }
    });
  });

  describe('DELETE /api/keys/:id', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).delete(`/api/keys/${new Types.ObjectId()}`);
      expect(res.status).toBe(401);
    });

    it('deletes an owned key', async () => {
      // Create a key first
      const createRes = await request(app)
        .post('/api/keys')
        .set('Cookie', sessionCookie)
        .send({ label: 'To Delete' });
      expect(createRes.status).toBe(201);
      const keyId = createRes.body.id;

      const res = await request(app)
        .delete(`/api/keys/${keyId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
    });

    it('returns 404 for a key that does not exist', async () => {
      const res = await request(app)
        .delete(`/api/keys/${new Types.ObjectId()}`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(404);
    });

    it('cannot delete another user\'s key', async () => {
      // Create another user + key
      const otherUser = await upsertUserFromProfile({
        provider: 'github',
        id: 'other-user-for-delete-test',
        displayName: 'Other User',
        email: 'other@test.com',
      });
      const { ApiKeyModel } = require('../../models/ApiKey');
      const BoundApiKey = conn.model(ApiKeyModel.modelName, ApiKeyModel.schema);
      const otherKey = await BoundApiKey.create({
        userId: otherUser._id,
        key: `shard_otherkey${'z'.repeat(33)}`,
        label: 'Other key',
      });

      const res = await request(app)
        .delete(`/api/keys/${otherKey._id}`)
        .set('Cookie', sessionCookie);

      // 404 because the query filters by userId
      expect(res.status).toBe(404);
    });
  });

  describe('API key auth updates lastUsed', () => {
    it('auth via API key header updates lastUsed', async () => {
      // Create a key
      const createRes = await request(app)
        .post('/api/keys')
        .set('Cookie', sessionCookie)
        .send({ label: 'LastUsed Test' });
      expect(createRes.status).toBe(201);
      const apiKey = createRes.body.key;

      // Use the key to list keys (requireAuth path)
      const res = await request(app)
        .get('/api/keys')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);

      // Verify lastUsed was updated
      const { ApiKeyModel } = require('../../models/ApiKey');
      const BoundApiKey = conn.model(ApiKeyModel.modelName, ApiKeyModel.schema);
      const doc = await BoundApiKey.findOne({ key: apiKey });
      expect(doc?.lastUsed).not.toBeNull();
    });
  });
});

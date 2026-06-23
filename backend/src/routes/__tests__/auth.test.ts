/**
 * Task 2.2 — Auth routes tests (supertest)
 * GET /api/auth/:provider → redirects to OAuth
 * GET /api/auth/:provider/callback → handled by passport (mocked)
 * POST /api/auth/logout → clears cookie
 * GET /api/me → returns current user
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';

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
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import type { Application } from 'express';

describe('Auth routes', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  describe('GET /api/auth/:provider', () => {
    it('redirects to Google OAuth for provider=google', async () => {
      const res = await request(app).get('/api/auth/google');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/accounts\.google\.com/);
    });

    it('redirects to GitHub OAuth for provider=github', async () => {
      const res = await request(app).get('/api/auth/github');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/github\.com/);
    });

    it('returns 400 for unsupported provider', async () => {
      const res = await request(app).get('/api/auth/twitter');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the shard_token cookie', async () => {
      const userId = new Types.ObjectId().toHexString();
      const token = await createSession(userId);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `shard_token=${token}`);

      expect(res.status).toBe(200);
      // Cookie should be cleared (maxAge 0 or expires in past)
      const cookieHeader = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookieHeader).toBeDefined();
      const shardCookie = (cookieHeader as string[]).find((c: string) => c.startsWith('shard_token='));
      expect(shardCookie).toBeDefined();
      // Cleared cookie has empty value or maxAge=0
      expect(shardCookie).toMatch(/shard_token=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });

    it('returns 200 even if no cookie present', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/me', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });

    it('returns user info when authenticated via cookie', async () => {
      // Create a real user + session
      const user = await upsertUserFromProfile({
        provider: 'google',
        id: 'me-test-001',
        displayName: 'Me User',
        email: 'me@example.com',
      });
      const token = await createSession(user._id.toString());

      const res = await request(app)
        .get('/api/me')
        .set('Cookie', `shard_token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('me@example.com');
      expect(res.body.displayName).toBe('Me User');
      expect(res.body.provider).toBe('google');
      // First user ever is always active (admin + active rule)
      expect(res.body.status).toBe('active');
    });
  });
});

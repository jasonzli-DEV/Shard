/**
 * Admin routes tests
 * Tests: access mode toggle, user approve/deny/role, invites, pending gating
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { Application } from 'express';

process.env.JWT_SECRET = 'admin-test-jwt-secret-at-least-32!!';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  conn = await mongoose.createConnection(uri).asPromise();
  await mongoose.connect(uri);

  const { setSessionConnection } = require('../../auth/sessions');
  setSessionConnection(conn);

  const { setPassportConnection } = require('../../auth/passport');
  setPassportConnection(conn);

  const { setAuthMiddlewareConnection } = require('../../middleware/auth');
  setAuthMiddlewareConnection(conn);

  const { setAuthRoutesConnection } = require('../../routes/auth');
  setAuthRoutesConnection(conn);

  const { setAdminConnection } = require('../../routes/admin');
  setAdminConnection(conn);
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { resetConfigCache } from '../../config/configService';

describe('Admin routes', () => {
  let app: Application;
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = createApp();

    // Create first user (admin, active)
    const admin = await upsertUserFromProfile({
      provider: 'google',
      id: 'admin-001',
      displayName: 'Admin',
      email: 'admin@test.com',
    });
    adminId = admin._id.toString();
    const adminSession = await createSession(adminId);
    adminCookie = `shard_token=${adminSession}`;
  });

  afterEach(() => {
    resetConfigCache();
  });

  // ── GET /api/admin/users ──────────────────────────────────────────────────────

  it('GET /api/admin/users returns user list for admin', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('email');
    expect(res.body[0]).toHaveProperty('role');
    expect(res.body[0]).toHaveProperty('status');
  });

  it('GET /api/admin/users returns 401 for unauthenticated', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/users returns 403 for non-admin', async () => {
    // Create a regular user
    const user = await upsertUserFromProfile({
      provider: 'google',
      id: 'nonadmin-001',
      displayName: 'Regular',
      email: 'regular@test.com',
    });
    // Force active
    const { UserModel } = require('../../models/User');
    let BU: any;
    try { BU = conn.model(UserModel.modelName); } catch { BU = conn.model(UserModel.modelName, UserModel.schema); }
    await BU.updateOne({ _id: user._id }, { status: 'active' });

    const session = await createSession(user._id.toString());
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `shard_token=${session}`);
    expect(res.status).toBe(403);
  });

  // ── Pending user blocked from protected routes ──────────────────────────────

  it('pending user gets 403 from protected routes with error pending_approval', async () => {
    const pendingUser = await upsertUserFromProfile({
      provider: 'google',
      id: 'pending-001',
      displayName: 'Pending',
      email: 'pending@test.com',
    });
    // User is pending by default (not first, accessMode=approval)
    const session = await createSession(pendingUser._id.toString());
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `shard_token=${session}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('pending_approval');
  });

  it('pending user can still GET /api/me', async () => {
    const pendingUser = await upsertUserFromProfile({
      provider: 'google',
      id: 'pending-002',
      displayName: 'Pending2',
      email: 'pending2@test.com',
    });
    const session = await createSession(pendingUser._id.toString());
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', `shard_token=${session}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  // ── POST /api/admin/users/:id/approve ─────────────────────────────────────────

  it('admin can approve a pending user', async () => {
    const pendingUser = await upsertUserFromProfile({
      provider: 'google',
      id: 'pending-003',
      displayName: 'Pending3',
      email: 'pending3@test.com',
    });
    const userId = pendingUser._id.toString();

    const res = await request(app)
      .post(`/api/admin/users/${userId}/approve`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');

    // Verify in DB
    const { UserModel } = require('../../models/User');
    let BU: any;
    try { BU = conn.model(UserModel.modelName); } catch { BU = conn.model(UserModel.modelName, UserModel.schema); }
    const updated = await BU.findById(userId).lean();
    expect((updated as any).status).toBe('active');
  });

  // ── POST /api/admin/users/:id/deny ───────────────────────────────────────────

  it('admin can deny (delete) a pending user', async () => {
    const pendingUser = await upsertUserFromProfile({
      provider: 'google',
      id: 'pending-deny-001',
      displayName: 'DenyMe',
      email: 'denyme@test.com',
    });
    const userId = pendingUser._id.toString();

    const res = await request(app)
      .post(`/api/admin/users/${userId}/deny`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    // User should be deleted
    const { UserModel } = require('../../models/User');
    let BU: any;
    try { BU = conn.model(UserModel.modelName); } catch { BU = conn.model(UserModel.modelName, UserModel.schema); }
    const deleted = await BU.findById(userId).lean();
    expect(deleted).toBeNull();
  });

  it('admin cannot deny themselves', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${adminId}/deny`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  // ── GET/PUT /api/admin/access-mode ────────────────────────────────────────────

  it('GET /api/admin/access-mode returns current mode', async () => {
    const res = await request(app)
      .get('/api/admin/access-mode')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(['open', 'approval']).toContain(res.body.accessMode);
  });

  // ── GET/POST/DELETE /api/admin/invites ────────────────────────────────────────

  it('admin can create and list invites', async () => {
    const createRes = await request(app)
      .post('/api/admin/invites')
      .set('Cookie', adminCookie)
      .send({ email: 'invited@test.com' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.email).toBe('invited@test.com');

    const listRes = await request(app)
      .get('/api/admin/invites')
      .set('Cookie', adminCookie);
    expect(listRes.status).toBe(200);
    const found = listRes.body.find((i: any) => i.email === 'invited@test.com');
    expect(found).toBeDefined();
  });

  it('admin can delete an invite', async () => {
    const createRes = await request(app)
      .post('/api/admin/invites')
      .set('Cookie', adminCookie)
      .send({ email: 'todelete@test.com' });
    const inviteId = createRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/admin/invites/${inviteId}`)
      .set('Cookie', adminCookie);
    expect(deleteRes.status).toBe(200);
  });

  it('invited email creates active user on first sign-in', async () => {
    // Create invite
    await request(app)
      .post('/api/admin/invites')
      .set('Cookie', adminCookie)
      .send({ email: 'newinvite@test.com' });

    // Simulate OAuth sign-in for invited email
    const invitedUser = await upsertUserFromProfile({
      provider: 'google',
      id: 'invited-new-001',
      displayName: 'InvitedUser',
      email: 'newinvite@test.com',
    });

    expect(invitedUser.status).toBe('active');
  });
});

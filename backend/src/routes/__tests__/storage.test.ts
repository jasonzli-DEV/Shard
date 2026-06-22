/**
 * Task 5.4 — Storage stats + org key routes tests (supertest)
 * Tests: add org (validates key via mocked atlas), list usage, delete org.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { Application } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';
process.env.PUBLIC_URL = 'http://localhost:4000';

// Mock atlas client so POST /api/orgs doesn't make real HTTP calls
jest.mock('../../atlas/client', () => ({
  makeAtlasClient: jest.fn(),
  M0_ELIGIBLE_REGIONS: ['US_EAST_1', 'US_WEST_2', 'EU_WEST_1'],
}));

import { makeAtlasClient } from '../../atlas/client';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  await mongoose.connect(mongod.getUri());

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

  const { setFilesConnection } = require('../../routes/files');
  setFilesConnection(conn);

  const { setStorageConnection } = require('../../routes/storage');
  setStorageConnection(conn);

  const { setV1Connection } = require('../../routes/v1');
  setV1Connection(conn);
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  const { OrgKeyModel } = require('../../models/OrgKey');
  const { StorageClusterModel } = require('../../models/StorageCluster');
  await OrgKeyModel.deleteMany({});
  await StorageClusterModel.deleteMany({});
  jest.clearAllMocks();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { OrgKeyModel } from '../../models/OrgKey';
import { StorageClusterModel } from '../../models/StorageCluster';

describe('Storage routes', () => {
  let app: Application;
  let sessionCookie: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();

    const user = await upsertUserFromProfile({
      provider: 'github',
      id: 'storage-test-user',
      displayName: 'Storage Tester',
      email: 'storage@test.com',
    });
    userId = user._id.toString();
    const token = await createSession(userId);
    sessionCookie = `shard_token=${token}`;
  });

  // ── GET /api/storage ─────────────────────────────────────────────────────
  describe('GET /api/storage', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/storage');
      expect(res.status).toBe(401);
    });

    it('returns empty stats when no orgs', async () => {
      const res = await request(app).get('/api/storage').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.orgs).toHaveLength(0);
      expect(res.body.totalUsedBytes).toBe(0);
      expect(res.body.totalCapacityBytes).toBe(0);
      expect(res.body.usedPercent).toBe(0);
    });

    it('returns per-org cluster usage grouped by org', async () => {
      const orgKey = await OrgKeyModel.create({
        userId: new Types.ObjectId(userId),
        label: 'Prod Org',
        publicKey: 'pub',
        privateKey: 'priv',
        orgId: 'org-abc',
        clusterCount: 2,
      });

      await StorageClusterModel.create({
        userId: new Types.ObjectId(userId),
        orgKeyId: orgKey._id,
        clusterId: 'cl-1',
        projectId: 'proj-1',
        clusterName: 'cl-1',
        connectionUri: 'mongodb+srv://u:p@cl1.net/shard',
        status: 'active',
        storageUsedBytes: 200 * 1024 * 1024,
        storageCapacityBytes: 512 * 1024 * 1024,
      });

      await StorageClusterModel.create({
        userId: new Types.ObjectId(userId),
        orgKeyId: orgKey._id,
        clusterId: 'cl-2',
        projectId: 'proj-2',
        clusterName: 'cl-2',
        connectionUri: 'mongodb+srv://u:p@cl2.net/shard',
        status: 'full',
        storageUsedBytes: 512 * 1024 * 1024,
        storageCapacityBytes: 512 * 1024 * 1024,
      });

      const res = await request(app).get('/api/storage').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.orgs).toHaveLength(1);

      const org = res.body.orgs[0];
      expect(org.label).toBe('Prod Org');
      expect(org.clusters).toHaveLength(2);
      expect(org.totalUsedBytes).toBe(712 * 1024 * 1024);
      expect(org.totalCapacityBytes).toBe(1024 * 1024 * 1024);
      expect(org.activeCluster).not.toBeNull();
      expect(org.activeCluster.clusterId).toBe('cl-1');
      expect(org.activeProvisioning).toBe(false);

      expect(res.body.totalUsedBytes).toBe(712 * 1024 * 1024);
    });

    it('reports activeProvisioning true when a cluster is provisioning', async () => {
      const orgKey = await OrgKeyModel.create({
        userId: new Types.ObjectId(userId),
        label: 'ProvOrg',
        publicKey: 'pub2',
        privateKey: 'priv2',
        orgId: 'org-prov',
        clusterCount: 1,
      });

      await StorageClusterModel.create({
        userId: new Types.ObjectId(userId),
        orgKeyId: orgKey._id,
        clusterId: 'cl-prov',
        projectId: 'proj-prov',
        clusterName: 'cl-prov',
        connectionUri: 'mongodb+srv://u:p@clprov.net/shard',
        status: 'provisioning',
        storageUsedBytes: 0,
        storageCapacityBytes: 512 * 1024 * 1024,
      });

      const res = await request(app).get('/api/storage').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.orgs[0].activeProvisioning).toBe(true);
    });
  });

  // ── GET /api/orgs ─────────────────────────────────────────────────────────
  describe('GET /api/orgs', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/orgs');
      expect(res.status).toBe(401);
    });

    it('lists org keys without privateKey', async () => {
      await OrgKeyModel.create({
        userId: new Types.ObjectId(userId),
        label: 'My Org',
        publicKey: 'pub-key',
        privateKey: 'secret-priv',
        orgId: 'org-listed',
        clusterCount: 3,
        region: 'EU_WEST_1',
      });

      const res = await request(app).get('/api/orgs').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].label).toBe('My Org');
      expect(res.body[0].publicKey).toBe('pub-key');
      expect(res.body[0].privateKey).toBeUndefined(); // must never expose
      expect(res.body[0].orgId).toBe('org-listed');
      expect(res.body[0].region).toBe('EU_WEST_1');
    });
  });

  // ── POST /api/orgs ────────────────────────────────────────────────────────
  describe('POST /api/orgs', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/orgs').send({ label: 'X', publicKey: 'p', privateKey: 'k' });
      expect(res.status).toBe(401);
    });

    it('creates an org key after validating with atlas', async () => {
      const mockDiscoverOrgId = jest.fn().mockResolvedValue('atlas-org-789');
      (makeAtlasClient as jest.Mock).mockReturnValue({
        discoverOrgId: mockDiscoverOrgId,
      });

      const res = await request(app)
        .post('/api/orgs')
        .set('Cookie', sessionCookie)
        .send({
          label: 'New Org',
          publicKey: 'valid-pub',
          privateKey: 'valid-priv',
          region: 'US_EAST_1',
        });

      expect(res.status).toBe(201);
      expect(res.body.orgId).toBe('atlas-org-789');
      expect(res.body.label).toBe('New Org');
      expect(res.body.region).toBe('US_EAST_1');
      expect(res.body.privateKey).toBeUndefined(); // never returned

      // Atlas client was called with the provided keys
      expect(makeAtlasClient).toHaveBeenCalledWith({
        publicKey: 'valid-pub',
        privateKey: 'valid-priv',
      });
      expect(mockDiscoverOrgId).toHaveBeenCalled();
    });

    it('returns 422 when atlas rejects credentials', async () => {
      (makeAtlasClient as jest.Mock).mockReturnValue({
        discoverOrgId: jest.fn().mockRejectedValue(new Error('401 Unauthorized')),
      });

      const res = await request(app)
        .post('/api/orgs')
        .set('Cookie', sessionCookie)
        .send({
          label: 'Bad Org',
          publicKey: 'bad-pub',
          privateKey: 'bad-priv',
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain('validation failed');
    });

    it('returns 400 when label is missing', async () => {
      const res = await request(app)
        .post('/api/orgs')
        .set('Cookie', sessionCookie)
        .send({ publicKey: 'p', privateKey: 'k' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when publicKey is missing', async () => {
      const res = await request(app)
        .post('/api/orgs')
        .set('Cookie', sessionCookie)
        .send({ label: 'X', privateKey: 'k' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when privateKey is missing', async () => {
      const res = await request(app)
        .post('/api/orgs')
        .set('Cookie', sessionCookie)
        .send({ label: 'X', publicKey: 'p' });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/orgs/:id ──────────────────────────────────────────────────
  describe('DELETE /api/orgs/:id', () => {
    it('requires auth', async () => {
      const res = await request(app).delete(`/api/orgs/${new Types.ObjectId()}`);
      expect(res.status).toBe(401);
    });

    it('deletes an owned org key', async () => {
      const org = await OrgKeyModel.create({
        userId: new Types.ObjectId(userId),
        label: 'ToDelete',
        publicKey: 'dp',
        privateKey: 'dk',
        orgId: 'org-del',
        clusterCount: 0,
      });

      const res = await request(app)
        .delete(`/api/orgs/${org._id}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
      expect(await OrgKeyModel.findById(org._id)).toBeNull();
    });

    it('returns 404 for non-existent org key', async () => {
      const res = await request(app)
        .delete(`/api/orgs/${new Types.ObjectId()}`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(404);
    });

    it("cannot delete another user's org key", async () => {
      const otherId = new Types.ObjectId();
      const org = await OrgKeyModel.create({
        userId: otherId,
        label: 'OtherOrg',
        publicKey: 'op',
        privateKey: 'ok',
        orgId: 'org-other',
        clusterCount: 0,
      });

      const res = await request(app)
        .delete(`/api/orgs/${org._id}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404); // filtered by userId
    });

    it('returns 400 for invalid id format', async () => {
      const res = await request(app).delete('/api/orgs/not-an-objectid').set('Cookie', sessionCookie);
      expect(res.status).toBe(400);
    });
  });
});

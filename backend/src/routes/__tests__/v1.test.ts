/**
 * Task 5.3 — REST API v1 tests (supertest)
 * Tests: API-key auth, list+upload+download, me, storage.
 * storageService is mocked.
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

jest.mock('../../storage/storageService', () => ({
  storeFile: jest.fn(),
  readFile: jest.fn(),
  deleteFileBytes: jest.fn().mockResolvedValue(undefined),
}));

import { storeFile, readFile } from '../../storage/storageService';

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

  const { setV1Connection } = require('../../routes/v1');
  setV1Connection(conn);
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  const { FileModel } = require('../../models/File');
  const { OrgKeyModel } = require('../../models/OrgKey');
  const { StorageClusterModel } = require('../../models/StorageCluster');
  await FileModel.deleteMany({});
  await OrgKeyModel.deleteMany({});
  await StorageClusterModel.deleteMany({});
  jest.clearAllMocks();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { FileModel } from '../../models/File';
import { ApiKeyModel } from '../../models/ApiKey';
import { OrgKeyModel } from '../../models/OrgKey';
import { StorageClusterModel } from '../../models/StorageCluster';

describe('REST API v1', () => {
  let app: Application;
  let userId: string;
  let apiKey: string;
  let sessionCookie: string;

  beforeAll(async () => {
    app = createApp();

    const user = await upsertUserFromProfile({
      provider: 'github',
      id: 'v1-test-user',
      displayName: 'V1 Tester',
      email: 'v1@test.com',
    });
    userId = user._id.toString();

    // Create an API key directly
    const keyValue = `shard_v1testkey${'x'.repeat(30)}`;
    const BoundApiKey = conn.model(ApiKeyModel.modelName, ApiKeyModel.schema);
    await BoundApiKey.create({
      userId: new Types.ObjectId(userId),
      key: keyValue,
      label: 'V1 Test Key',
    });
    apiKey = keyValue;

    const token = await createSession(userId);
    sessionCookie = `shard_token=${token}`;
  });

  describe('Auth', () => {
    it('rejects requests without credentials', async () => {
      const res = await request(app).get('/api/v1/me');
      expect(res.status).toBe(401);
    });

    it('accepts API key auth', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
    });

    it('accepts session cookie auth', async () => {
      const res = await request(app).get('/api/v1/me').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/me', () => {
    it('returns user info', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('v1@test.com');
      expect(res.body.displayName).toBe('V1 Tester');
      expect(res.body.id).toBeDefined();
    });
  });

  describe('GET /api/v1/storage', () => {
    it('returns storage stats with orgs and clusters', async () => {
      // Create org key and cluster
      const orgKey = await OrgKeyModel.create({
        userId: new Types.ObjectId(userId),
        label: 'My Org',
        publicKey: 'pub-key',
        privateKey: 'priv-key',
        orgId: 'org-123',
        clusterCount: 1,
      });
      await StorageClusterModel.create({
        userId: new Types.ObjectId(userId),
        orgKeyId: orgKey._id,
        clusterId: 'cluster-1',
        projectId: 'proj-1',
        clusterName: 'cluster-1',
        connectionUri: 'mongodb+srv://test:test@cluster-1.mongodb.net/shard',
        status: 'active',
        storageUsedBytes: 100 * 1024 * 1024,
        storageCapacityBytes: 512 * 1024 * 1024,
      });

      const res = await request(app)
        .get('/api/v1/storage')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.orgs).toHaveLength(1);
      expect(res.body.orgs[0].label).toBe('My Org');
      expect(res.body.orgs[0].clusters).toHaveLength(1);
      expect(res.body.totalUsedBytes).toBe(100 * 1024 * 1024);
      // 100/512 = 19.53% → rounds to 20
      expect(res.body.usedPercent).toBe(20);
    });

    it('returns empty stats with no orgs', async () => {
      const res = await request(app)
        .get('/api/v1/storage')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.orgs).toHaveLength(0);
      expect(res.body.totalUsedBytes).toBe(0);
    });
  });

  describe('GET /api/v1/files', () => {
    it('lists files at root', async () => {
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'v1folder',
        path: '/v1folder',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .get('/api/v1/files')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('v1folder');
    });

    it('looks up by path', async () => {
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'bypath.txt',
        path: '/bypath.txt',
        mimeType: 'text/plain',
        size: 10,
        type: 'file',
      });

      const res = await request(app)
        .get('/api/v1/files?path=/bypath.txt')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body[0].name).toBe('bypath.txt');
    });

    it('returns 404 for unknown path', async () => {
      const res = await request(app)
        .get('/api/v1/files?path=/nonexistent.txt')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/files/:id', () => {
    it('returns single file metadata', async () => {
      const file = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'meta.txt',
        path: '/meta.txt',
        mimeType: 'text/plain',
        size: 5,
        type: 'file',
      });

      const res = await request(app)
        .get(`/api/v1/files/${file._id}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('meta.txt');
    });

    it('returns 404 for unknown file', async () => {
      const res = await request(app)
        .get(`/api/v1/files/${new Types.ObjectId()}`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
    });

    it('cannot see another user\'s file', async () => {
      const otherId = new Types.ObjectId();
      const file = await FileModel.create({
        userId: otherId,
        name: 'other.txt',
        path: '/other.txt',
        mimeType: 'text/plain',
        size: 5,
        type: 'file',
      });

      const res = await request(app)
        .get(`/api/v1/files/${file._id}`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/files/:id/download', () => {
    it('downloads a file with API key auth', async () => {
      const file = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'v1-dl.txt',
        path: '/v1-dl.txt',
        mimeType: 'text/plain',
        size: 7,
        type: 'file',
      });
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('content'));

      const res = await request(app)
        .get(`/api/v1/files/${file._id}/download`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('v1-dl.txt');
    });
  });

  describe('POST /api/v1/files (upload)', () => {
    it('uploads a file with API key auth', async () => {
      const mockFile = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(userId),
        name: 'v1upload.txt',
        path: '/v1upload.txt',
        mimeType: 'text/plain',
        size: 5,
        type: 'file',
        starred: false,
        encrypted: false,
      };
      (storeFile as jest.Mock).mockResolvedValue(mockFile);

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${apiKey}`)
        .attach('file', Buffer.from('hello'), 'v1upload.txt');

      expect(res.status).toBe(201);
      expect(storeFile).toHaveBeenCalledWith(
        expect.objectContaining({ userId, name: 'v1upload.txt' }),
      );
    });

    it('returns 400 without file', async () => {
      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/folders', () => {
    it('creates a folder', async () => {
      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: 'V1Folder' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('V1Folder');
      expect(res.body.type).toBe('folder');
    });
  });

  describe('PATCH /api/v1/files/:id', () => {
    it('renames a file', async () => {
      const file = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'OldV1.txt',
        path: '/OldV1.txt',
        mimeType: 'text/plain',
        size: 0,
        type: 'file',
      });

      const res = await request(app)
        .patch(`/api/v1/files/${file._id}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: 'NewV1.txt' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('NewV1.txt');
    });
  });

  describe('DELETE /api/v1/files/:id (soft delete)', () => {
    it('soft-deletes a file', async () => {
      const file = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'DelV1.txt',
        path: '/DelV1.txt',
        mimeType: 'text/plain',
        size: 0,
        type: 'file',
      });

      const res = await request(app)
        .delete(`/api/v1/files/${file._id}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
    });
  });

  describe('API key auth list+upload+download integration', () => {
    it('full key-authed flow: create folder → list → upload → download', async () => {
      // Create folder
      const folderRes = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: 'Integration' });
      expect(folderRes.status).toBe(201);

      // List
      const listRes = await request(app)
        .get('/api/v1/files')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.some((f: any) => f.name === 'Integration')).toBe(true);

      // Upload (mocked)
      const mockFile = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'int.txt',
        path: '/int.txt',
        mimeType: 'text/plain',
        size: 3,
        type: 'file',
      });
      (storeFile as jest.Mock).mockResolvedValue(mockFile.toObject());

      const uploadRes = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${apiKey}`)
        .attach('file', Buffer.from('int'), 'int.txt');
      expect(uploadRes.status).toBe(201);

      // Download
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('int'));
      const dlRes = await request(app)
        .get(`/api/v1/files/${mockFile._id}/download`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(dlRes.status).toBe(200);
    });
  });
});

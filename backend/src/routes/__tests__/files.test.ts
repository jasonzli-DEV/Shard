/**
 * Task 5.2 — File routes tests (supertest)
 * Tests: upload→list→download→delete→restore
 * storageService is mocked so no real GridFS is needed.
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

// Mock storageService before imports
jest.mock('../../storage/storageService', () => ({
  storeFile: jest.fn(),
  readFile: jest.fn(),
  deleteFileBytes: jest.fn().mockResolvedValue(undefined),
  storeChunk: jest.fn().mockResolvedValue(1024),
  abortUpload: jest.fn().mockResolvedValue(undefined),
}));

// Mock ensureCapacity from provisioner
jest.mock('../../storage/provisioner', () => ({
  ensureCapacity: jest.fn().mockResolvedValue({
    _id: new (require('mongoose').Types.ObjectId)(),
    clusterId: 'test-cluster',
    storageUsedBytes: 0,
    storageCapacityBytes: 512 * 1024 * 1024,
  }),
}));

import { storeFile, readFile, storeChunk, abortUpload } from '../../storage/storageService';

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
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  const { FileModel } = require('../../models/File');
  await FileModel.deleteMany({});
  jest.clearAllMocks();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { FileModel } from '../../models/File';

describe('File routes', () => {
  let app: Application;
  let sessionCookie: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();

    const user = await upsertUserFromProfile({
      provider: 'github',
      id: 'files-test-user',
      displayName: 'File Tester',
      email: 'files@test.com',
    });
    userId = user._id.toString();
    const token = await createSession(userId);
    sessionCookie = `shard_token=${token}`;
  });

  describe('GET /api/files', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/files');
      expect(res.status).toBe(401);
    });

    it('lists root files', async () => {
      // Create a folder directly
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'Docs',
        path: '/Docs',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app).get('/api/files').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Docs');
    });

    it('excludes soft-deleted items', async () => {
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'Deleted',
        path: '/Deleted',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
        deletedAt: new Date(),
      });

      const res = await request(app).get('/api/files').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe('POST /api/folders', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/folders').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });

    it('creates a folder', async () => {
      const res = await request(app)
        .post('/api/folders')
        .set('Cookie', sessionCookie)
        .send({ name: 'MyFolder' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('MyFolder');
      expect(res.body.type).toBe('folder');
      expect(res.body.path).toBe('/MyFolder');
    });

    it('returns 400 without name', async () => {
      const res = await request(app)
        .post('/api/folders')
        .set('Cookie', sessionCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate path', async () => {
      await request(app)
        .post('/api/folders')
        .set('Cookie', sessionCookie)
        .send({ name: 'DupFolder' });

      const res = await request(app)
        .post('/api/folders')
        .set('Cookie', sessionCookie)
        .send({ name: 'DupFolder' });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/files (upload)', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/files').attach('file', Buffer.from('hi'), 'test.txt');
      expect(res.status).toBe(401);
    });

    it('uploads a file (mocked storageService)', async () => {
      const mockFile = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(userId),
        name: 'hello.txt',
        path: '/hello.txt',
        mimeType: 'text/plain',
        size: 5,
        type: 'file',
        starred: false,
        encrypted: false,
        deletedAt: null,
      };
      (storeFile as jest.Mock).mockResolvedValue(mockFile);

      const res = await request(app)
        .post('/api/files')
        .set('Cookie', sessionCookie)
        .attach('file', Buffer.from('hello'), 'hello.txt');

      expect(res.status).toBe(201);
      expect(storeFile).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          name: 'hello.txt',
          mimeType: 'text/plain',
          encrypt: false,
        }),
      );
    });

    it('returns 400 without file', async () => {
      const res = await request(app)
        .post('/api/files')
        .set('Cookie', sessionCookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/files/:id/download', () => {
    it('requires auth', async () => {
      const res = await request(app).get(`/api/files/${new Types.ObjectId()}/download`);
      expect(res.status).toBe(401);
    });

    it('downloads a file (mocked readFile)', async () => {
      const fileDoc = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'download.txt',
        path: '/download.txt',
        mimeType: 'text/plain',
        size: 13,
        type: 'file',
      });

      const content = Buffer.from('hello download');
      (readFile as jest.Mock).mockResolvedValue(content);

      const res = await request(app)
        .get(`/api/files/${fileDoc._id}/download`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toContain('download.txt');
      expect(readFile).toHaveBeenCalledWith(fileDoc._id.toString(), undefined);
    });

    it('returns 403 for another user\'s file', async () => {
      const otherId = new Types.ObjectId().toString();
      const fileDoc = await FileModel.create({
        userId: new Types.ObjectId(otherId),
        name: 'other.txt',
        path: '/other.txt',
        mimeType: 'text/plain',
        size: 10,
        type: 'file',
      });

      const res = await request(app)
        .get(`/api/files/${fileDoc._id}/download`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent file', async () => {
      const res = await request(app)
        .get(`/api/files/${new Types.ObjectId()}/download`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(404);
    });

    it('returns 400 for folder download', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'FolderDl',
        path: '/FolderDl',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .get(`/api/files/${folder._id}/download`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(400);
    });

    // I1: soft-deleted (trashed) files must not be downloadable
    it('returns 404 for a trashed (soft-deleted) file', async () => {
      const fileDoc = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'trashed-auth.txt',
        path: '/trashed-auth.txt',
        mimeType: 'text/plain',
        size: 10,
        type: 'file',
        deletedAt: new Date(), // soft-deleted
      });

      const res = await request(app)
        .get(`/api/files/${fileDoc._id}/download`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/files/:id (rename/move/star)', () => {
    it('requires auth', async () => {
      const res = await request(app).patch(`/api/files/${new Types.ObjectId()}`).send({ name: 'x' });
      expect(res.status).toBe(401);
    });

    it('renames a folder', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'OldName',
        path: '/OldName',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .patch(`/api/files/${folder._id}`)
        .set('Cookie', sessionCookie)
        .send({ name: 'NewName' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('NewName');
      expect(res.body.path).toBe('/NewName');
    });

    it('stars a file', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'StarMe',
        path: '/StarMe',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
        starred: false,
      });

      const res = await request(app)
        .patch(`/api/files/${folder._id}`)
        .set('Cookie', sessionCookie)
        .send({ starred: true });

      expect(res.status).toBe(200);
      expect(res.body.starred).toBe(true);
    });

    it('returns 400 if no valid field provided', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'NoPatch',
        path: '/NoPatch',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .patch(`/api/files/${folder._id}`)
        .set('Cookie', sessionCookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown file', async () => {
      const res = await request(app)
        .patch(`/api/files/${new Types.ObjectId()}`)
        .set('Cookie', sessionCookie)
        .send({ name: 'whatever' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/files/:id (soft delete)', () => {
    it('requires auth', async () => {
      const res = await request(app).delete(`/api/files/${new Types.ObjectId()}`);
      expect(res.status).toBe(401);
    });

    it('soft-deletes a file', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'ToDelete',
        path: '/ToDelete',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .delete(`/api/files/${folder._id}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('trash');

      const updated = await FileModel.findById(folder._id);
      expect(updated?.deletedAt).toBeTruthy();
    });

    it('returns 404 for unknown file', async () => {
      const res = await request(app)
        .delete(`/api/files/${new Types.ObjectId()}`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/trash', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/trash');
      expect(res.status).toBe(401);
    });

    it('returns trash items', async () => {
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'InTrash',
        path: '/InTrash',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
        deletedAt: new Date(),
      });

      const res = await request(app).get('/api/trash').set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].name).toBe('InTrash');
    });
  });

  describe('POST /api/files/:id/restore', () => {
    it('requires auth', async () => {
      const res = await request(app).post(`/api/files/${new Types.ObjectId()}/restore`);
      expect(res.status).toBe(401);
    });

    it('restores a deleted file', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'RestoreMe',
        path: '/RestoreMe',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
        deletedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/files/${folder._id}/restore`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.deletedAt).toBeNull();
    });

    it('returns 400 when restoring non-deleted file', async () => {
      const folder = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'NotDeleted',
        path: '/NotDeleted',
        mimeType: 'application/x-directory',
        size: 0,
        type: 'folder',
      });

      const res = await request(app)
        .post(`/api/files/${folder._id}/restore`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/files/:id/purge', () => {
    it('requires auth', async () => {
      const res = await request(app).delete(`/api/files/${new Types.ObjectId()}/purge`);
      expect(res.status).toBe(401);
    });

    it('purges a file permanently', async () => {
      const file = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'PurgeMe.txt',
        path: '/PurgeMe.txt',
        mimeType: 'text/plain',
        size: 10,
        type: 'file',
        deletedAt: new Date(),
      });

      const res = await request(app)
        .delete(`/api/files/${file._id}/purge`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      const found = await FileModel.findById(file._id);
      expect(found).toBeNull();
    });
  });

  describe('GET /api/search', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/search?q=test');
      expect(res.status).toBe(401);
    });

    it('searches files by name', async () => {
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'invoice-2024.pdf',
        path: '/invoice-2024.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        type: 'file',
      });
      await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'photo.jpg',
        path: '/photo.jpg',
        mimeType: 'image/jpeg',
        size: 2000,
        type: 'file',
      });

      const res = await request(app)
        .get('/api/search?q=invoice')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('invoice-2024.pdf');
    });
  });

  describe('Chunked upload routes', () => {
    describe('POST /api/files/upload/init', () => {
      it('requires auth', async () => {
        const res = await request(app)
          .post('/api/files/upload/init')
          .send({ name: 'big.mp4', mimeType: 'video/mp4', size: 10_000_000 });
        expect(res.status).toBe(401);
      });

      it('returns 400 without name', async () => {
        const res = await request(app)
          .post('/api/files/upload/init')
          .set('Cookie', sessionCookie)
          .send({ mimeType: 'video/mp4' });
        expect(res.status).toBe(400);
      });

      it('creates a File stub and returns fileId', async () => {
        const res = await request(app)
          .post('/api/files/upload/init')
          .set('Cookie', sessionCookie)
          .send({ name: 'video.mp4', mimeType: 'video/mp4', size: 8_000_000 });

        expect(res.status).toBe(201);
        expect(res.body.fileId).toBeTruthy();

        const fileDoc = await FileModel.findById(res.body.fileId);
        expect(fileDoc).toBeTruthy();
        expect(fileDoc!.uploading).toBe(true);
        expect(fileDoc!.name).toBe('video.mp4');
      });

      it('excludes uploading files from GET /api/files', async () => {
        const initRes = await request(app)
          .post('/api/files/upload/init')
          .set('Cookie', sessionCookie)
          .send({ name: 'pending.mp4', mimeType: 'video/mp4' });
        expect(initRes.status).toBe(201);

        const listRes = await request(app).get('/api/files').set('Cookie', sessionCookie);
        expect(listRes.status).toBe(200);
        const found = listRes.body.find((f: any) => f.name === 'pending.mp4');
        expect(found).toBeUndefined();
      });
    });

    describe('POST /api/files/upload/chunk', () => {
      it('requires auth', async () => {
        const res = await request(app)
          .post('/api/files/upload/chunk?fileId=000000000000000000000000&index=0')
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('data'));
        expect(res.status).toBe(401);
      });

      it('returns 400 for missing fileId', async () => {
        const res = await request(app)
          .post('/api/files/upload/chunk?index=0')
          .set('Cookie', sessionCookie)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('data'));
        expect(res.status).toBe(400);
      });

      it('returns 404 for unknown fileId', async () => {
        const fakeId = new Types.ObjectId().toString();
        const res = await request(app)
          .post(`/api/files/upload/chunk?fileId=${fakeId}&index=0`)
          .set('Cookie', sessionCookie)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('chunk data'));
        expect(res.status).toBe(404);
      });

      it('stores a chunk and returns {ok:true,index}', async () => {
        // Create an in-progress file
        const fileDoc = await FileModel.create({
          userId: new Types.ObjectId(userId),
          name: 'chunk-test.bin',
          path: '/chunk-test.bin',
          mimeType: 'application/octet-stream',
          size: 0,
          type: 'file',
          uploading: true,
        });

        const res = await request(app)
          .post(`/api/files/upload/chunk?fileId=${fileDoc._id}&index=0`)
          .set('Cookie', sessionCookie)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('hello chunk'));

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.index).toBe(0);
        expect(storeChunk).toHaveBeenCalled();
      });

      it('returns 409 if file is already completed', async () => {
        const fileDoc = await FileModel.create({
          userId: new Types.ObjectId(userId),
          name: 'completed.bin',
          path: '/completed.bin',
          mimeType: 'application/octet-stream',
          size: 100,
          type: 'file',
          uploading: false,
        });

        const res = await request(app)
          .post(`/api/files/upload/chunk?fileId=${fileDoc._id}&index=0`)
          .set('Cookie', sessionCookie)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('data'));

        expect(res.status).toBe(409);
      });
    });

    describe('POST /api/files/upload/complete', () => {
      it('requires auth', async () => {
        const res = await request(app)
          .post('/api/files/upload/complete')
          .send({ fileId: new Types.ObjectId().toString() });
        expect(res.status).toBe(401);
      });

      it('returns 400 without fileId', async () => {
        const res = await request(app)
          .post('/api/files/upload/complete')
          .set('Cookie', sessionCookie)
          .send({});
        expect(res.status).toBe(400);
      });

      it('finalises upload: sets size and uploading:false', async () => {
        const { BlobModel } = require('../../models/Blob');
        const fileDoc = await FileModel.create({
          userId: new Types.ObjectId(userId),
          name: 'tofinalise.bin',
          path: '/tofinalise.bin',
          mimeType: 'application/octet-stream',
          size: 0,
          type: 'file',
          uploading: true,
        });

        // Seed blob records so complete can sum them
        await BlobModel.create({
          fileId: fileDoc._id,
          clusterId: new Types.ObjectId(),
          gridfsId: new Types.ObjectId(),
          index: 0,
          size: 1044,
          plaintextSize: 1000,
        });
        await BlobModel.create({
          fileId: fileDoc._id,
          clusterId: new Types.ObjectId(),
          gridfsId: new Types.ObjectId(),
          index: 1,
          size: 544,
          plaintextSize: 500,
        });

        const res = await request(app)
          .post('/api/files/upload/complete')
          .set('Cookie', sessionCookie)
          .send({ fileId: fileDoc._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.uploading).toBe(false);
        expect(res.body.size).toBe(1500); // 1000 + 500 plaintext sizes

        const updated = await FileModel.findById(fileDoc._id);
        expect(updated!.uploading).toBe(false);
        expect(updated!.size).toBe(1500);

        await BlobModel.deleteMany({ fileId: fileDoc._id });
      });

      it('returns 404 for unknown fileId', async () => {
        const res = await request(app)
          .post('/api/files/upload/complete')
          .set('Cookie', sessionCookie)
          .send({ fileId: new Types.ObjectId().toString() });
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/files/upload/abort', () => {
      it('requires auth', async () => {
        const res = await request(app)
          .post('/api/files/upload/abort')
          .send({ fileId: new Types.ObjectId().toString() });
        expect(res.status).toBe(401);
      });

      it('aborts upload and removes File doc', async () => {
        const fileDoc = await FileModel.create({
          userId: new Types.ObjectId(userId),
          name: 'toabort.bin',
          path: '/toabort.bin',
          mimeType: 'application/octet-stream',
          size: 0,
          type: 'file',
          uploading: true,
        });

        const res = await request(app)
          .post('/api/files/upload/abort')
          .set('Cookie', sessionCookie)
          .send({ fileId: fileDoc._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(abortUpload).toHaveBeenCalledWith(fileDoc._id.toString());
      });

      it('returns 404 for unknown fileId', async () => {
        const res = await request(app)
          .post('/api/files/upload/abort')
          .set('Cookie', sessionCookie)
          .send({ fileId: new Types.ObjectId().toString() });
        expect(res.status).toBe(404);
      });
    });
  });

  describe('Upload→list→download→delete→restore flow', () => {
    it('full lifecycle', async () => {
      // 1. Upload (mocked)
      const mockFileDoc = await FileModel.create({
        userId: new Types.ObjectId(userId),
        name: 'lifecycle.txt',
        path: '/lifecycle.txt',
        mimeType: 'text/plain',
        size: 9,
        type: 'file',
      });
      (storeFile as jest.Mock).mockResolvedValue(mockFileDoc.toObject());

      const uploadRes = await request(app)
        .post('/api/files')
        .set('Cookie', sessionCookie)
        .attach('file', Buffer.from('lifecycle'), 'lifecycle.txt');
      expect(uploadRes.status).toBe(201);

      // 2. List
      const listRes = await request(app).get('/api/files').set('Cookie', sessionCookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.some((f: any) => f.name === 'lifecycle.txt')).toBe(true);

      // 3. Download
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('lifecycle'));
      const dlRes = await request(app)
        .get(`/api/files/${mockFileDoc._id}/download`)
        .set('Cookie', sessionCookie);
      expect(dlRes.status).toBe(200);

      // 4. Delete (soft)
      const delRes = await request(app)
        .delete(`/api/files/${mockFileDoc._id}`)
        .set('Cookie', sessionCookie);
      expect(delRes.status).toBe(200);

      // 5. Appears in trash
      const trashRes = await request(app).get('/api/trash').set('Cookie', sessionCookie);
      expect(trashRes.body.some((f: any) => f.name === 'lifecycle.txt')).toBe(true);

      // 6. Restore
      const restoreRes = await request(app)
        .post(`/api/files/${mockFileDoc._id}/restore`)
        .set('Cookie', sessionCookie);
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.deletedAt).toBeNull();
    });
  });
});

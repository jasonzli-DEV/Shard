/**
 * Task 6.1 — Shares routes + service tests (supertest)
 * Tests: share create, shared-with-me list, view vs edit enforcement,
 *        folder-share inheritance, unshare, list file's shares.
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

// Mock storageService
jest.mock('../../storage/storageService', () => ({
  storeFile: jest.fn(),
  readFile: jest.fn().mockResolvedValue(Buffer.from('file-content')),
  deleteFileBytes: jest.fn().mockResolvedValue(undefined),
}));

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

  const { setSharesConnection } = require('../../routes/shares');
  setSharesConnection(conn);
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  const { FileModel } = require('../../models/File');
  const { ShareModel } = require('../../models/Share');
  await FileModel.deleteMany({});
  await ShareModel.deleteMany({});
  jest.clearAllMocks();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { FileModel } from '../../models/File';
import { ShareModel } from '../../models/Share';

describe('Shares routes', () => {
  let app: Application;
  let ownerCookie: string;
  let recipientCookie: string;
  let thirdCookie: string;
  let ownerId: string;
  let recipientId: string;
  let thirdId: string;
  let recipientEmail: string;

  beforeAll(async () => {
    app = createApp();

    // Owner user
    const owner = await upsertUserFromProfile({
      provider: 'google',
      id: 'owner-001',
      email: 'owner@example.com',
      displayName: 'Owner',
    });
    ownerId = owner._id.toString();
    const ownerSession = await createSession(ownerId);
    ownerCookie = `shard_token=${ownerSession}`;

    // Recipient user
    const recipient = await upsertUserFromProfile({
      provider: 'google',
      id: 'recipient-001',
      email: 'recipient@example.com',
      displayName: 'Recipient',
    });
    recipientId = recipient._id.toString();
    recipientEmail = recipient.email;
    const recipientSession = await createSession(recipientId);
    recipientCookie = `shard_token=${recipientSession}`;

    // Third user
    const third = await upsertUserFromProfile({
      provider: 'google',
      id: 'third-001',
      email: 'third@example.com',
      displayName: 'Third',
    });
    thirdId = third._id.toString();
    const thirdSession = await createSession(thirdId);
    thirdCookie = `shard_token=${thirdSession}`;
  });

  afterEach(async () => {
    // Clean users from Share and File models between tests
    const { ShareModel } = require('../../models/Share');
    await ShareModel.deleteMany({});
    const { FileModel } = require('../../models/File');
    await FileModel.deleteMany({});
  });

  // ── Helper to create a file owned by owner ───────────────────────────────────
  async function createOwnerFile(name = 'test.txt', type: 'file' | 'folder' = 'file', parentId: string | null = null) {
    return FileModel.create({
      userId: new Types.ObjectId(ownerId),
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      name,
      path: parentId ? `parent/${name}` : name,
      mimeType: type === 'folder' ? 'application/x-directory' : 'text/plain',
      size: type === 'folder' ? 0 : 100,
      type,
      encrypted: false,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/files/:id/share
  // ─────────────────────────────────────────────────────────────────────────────

  it('POST /api/files/:id/share — owner can share with recipient by email', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: recipientEmail, permission: 'view' });

    expect(res.status).toBe(201);
    expect(res.body.fileId).toBe(file._id.toString());
    expect(res.body.sharedWithId).toBe(recipientId);
    expect(res.body.permission).toBe('view');
  });

  it('POST /api/files/:id/share — owner can share with recipient by userId', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ userId: recipientId, permission: 'edit' });

    expect(res.status).toBe(201);
    expect(res.body.permission).toBe('edit');
  });

  it('POST /api/files/:id/share — non-owner cannot share', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', recipientCookie)
      .send({ email: 'third@example.com', permission: 'view' });

    expect(res.status).toBe(403);
  });

  it('POST /api/files/:id/share — upserts permission (second share updates)', async () => {
    const file = await createOwnerFile();

    await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: recipientEmail, permission: 'view' });

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: recipientEmail, permission: 'edit' });

    expect(res.status).toBe(200);
    expect(res.body.permission).toBe('edit');

    // Only one share record
    const shares = await ShareModel.find({ fileId: file._id });
    expect(shares).toHaveLength(1);
  });

  it('POST /api/files/:id/share — returns 400 if no email or userId', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ permission: 'view' });

    expect(res.status).toBe(400);
  });

  it('POST /api/files/:id/share — returns 400 for invalid permission', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: recipientEmail, permission: 'admin' });

    expect(res.status).toBe(400);
  });

  it('POST /api/files/:id/share — returns 404 for unknown email', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: 'nonexistent@example.com', permission: 'view' });

    expect(res.status).toBe(404);
  });

  it('POST /api/files/:id/share — cannot share with self', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/share`)
      .set('Cookie', ownerCookie)
      .send({ email: 'owner@example.com', permission: 'view' });

    expect(res.status).toBe(400);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/files/:id/share/:userId
  // ─────────────────────────────────────────────────────────────────────────────

  it('DELETE /api/files/:id/share/:userId — owner can unshare', async () => {
    const file = await createOwnerFile();
    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });

    const res = await request(app)
      .delete(`/api/files/${file._id}/share/${recipientId}`)
      .set('Cookie', ownerCookie);

    expect(res.status).toBe(200);

    const shares = await ShareModel.find({ fileId: file._id });
    expect(shares).toHaveLength(0);
  });

  it('DELETE /api/files/:id/share/:userId — non-owner gets 403', async () => {
    const file = await createOwnerFile();
    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });

    const res = await request(app)
      .delete(`/api/files/${file._id}/share/${recipientId}`)
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(403);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/files/:id/shares (list file's shares)
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/files/:id/shares — owner can list shares', async () => {
    const file = await createOwnerFile();
    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });
    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(thirdId),
      permission: 'edit',
    });

    const res = await request(app)
      .get(`/api/files/${file._id}/shares`)
      .set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // Should include user info
    const viewShare = res.body.find((s: any) => s.permission === 'view');
    expect(viewShare).toBeDefined();
    expect(viewShare.sharedWith).toBeDefined();
    expect(viewShare.sharedWith.email).toBe('recipient@example.com');
  });

  it('GET /api/files/:id/shares — non-owner gets 403', async () => {
    const file = await createOwnerFile();

    const res = await request(app)
      .get(`/api/files/${file._id}/shares`)
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(403);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/shared-with-me
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/shared-with-me — returns files shared with current user', async () => {
    const file1 = await createOwnerFile('shared1.txt');
    const file2 = await createOwnerFile('shared2.txt');
    // file3 not shared
    await createOwnerFile('notshared.txt');

    await ShareModel.create({
      fileId: file1._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });
    await ShareModel.create({
      fileId: file2._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'edit',
    });

    const res = await request(app)
      .get('/api/shared-with-me')
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const names = res.body.map((item: any) => item.file.name);
    expect(names).toContain('shared1.txt');
    expect(names).toContain('shared2.txt');

    // Should include owner info and permission
    const item = res.body.find((i: any) => i.file.name === 'shared1.txt');
    expect(item.permission).toBe('view');
    expect(item.owner).toBeDefined();
    expect(item.owner.email).toBe('owner@example.com');
  });

  it('GET /api/shared-with-me — returns empty array when nothing shared', async () => {
    const res = await request(app)
      .get('/api/shared-with-me')
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // canAccess integration in file routes
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/files/:id/download — shared view user can download', async () => {
    const { readFile } = require('../../storage/storageService');
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('hello'));

    const file = await FileModel.create({
      userId: new Types.ObjectId(ownerId),
      name: 'downloadable.txt',
      path: 'downloadable.txt',
      mimeType: 'text/plain',
      size: 5,
      type: 'file',
      encrypted: false,
    });

    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });

    const res = await request(app)
      .get(`/api/files/${file._id}/download`)
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(200);
  });

  it('GET /api/files/:id/download — unshared user gets 403', async () => {
    const file = await FileModel.create({
      userId: new Types.ObjectId(ownerId),
      name: 'private.txt',
      path: 'private.txt',
      mimeType: 'text/plain',
      size: 5,
      type: 'file',
      encrypted: false,
    });

    const res = await request(app)
      .get(`/api/files/${file._id}/download`)
      .set('Cookie', thirdCookie);

    expect(res.status).toBe(403);
  });

  it('view-permission user cannot rename (PATCH) — gets 403', async () => {
    const file = await createOwnerFile('viewonly.txt');

    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });

    const res = await request(app)
      .patch(`/api/files/${file._id}`)
      .set('Cookie', recipientCookie)
      .send({ name: 'new-name.txt' });

    expect(res.status).toBe(403);
  });

  it('edit-permission user can rename (PATCH)', async () => {
    const file = await createOwnerFile('editable.txt');

    await ShareModel.create({
      fileId: file._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'edit',
    });

    const res = await request(app)
      .patch(`/api/files/${file._id}`)
      .set('Cookie', recipientCookie)
      .send({ name: 'renamed.txt' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('renamed.txt');
  });

  it('folder share — file inside shared folder is accessible (view)', async () => {
    const { readFile } = require('../../storage/storageService');
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('folder-child'));

    // Create folder owned by owner
    const folder = await FileModel.create({
      userId: new Types.ObjectId(ownerId),
      name: 'my-folder',
      path: 'my-folder',
      mimeType: 'application/x-directory',
      size: 0,
      type: 'folder',
      encrypted: false,
    });

    // Create file inside folder
    const childFile = await FileModel.create({
      userId: new Types.ObjectId(ownerId),
      parentId: folder._id,
      name: 'child.txt',
      path: 'my-folder/child.txt',
      mimeType: 'text/plain',
      size: 11,
      type: 'file',
      encrypted: false,
    });

    // Share only the folder with recipient
    await ShareModel.create({
      fileId: folder._id,
      sharedWithId: new Types.ObjectId(recipientId),
      permission: 'view',
    });

    // Recipient should be able to download child (inherits from folder share)
    const res = await request(app)
      .get(`/api/files/${childFile._id}/download`)
      .set('Cookie', recipientCookie);

    expect(res.status).toBe(200);
  });
});

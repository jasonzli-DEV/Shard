/**
 * Task 6.2 — Public links routes + service tests (supertest)
 * Tests: create link, anonymous metadata + download via slug,
 *        expired link returns 410, delete link, list user's links.
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
  readFile: jest.fn().mockResolvedValue(Buffer.from('public-file-content')),
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

  const { setPublicLinksConnection } = require('../../routes/publicLinks');
  setPublicLinksConnection(conn);
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  const { FileModel } = require('../../models/File');
  const { PublicLinkModel } = require('../../models/PublicLink');
  await FileModel.deleteMany({});
  await PublicLinkModel.deleteMany({});
  jest.clearAllMocks();
});

import { createApp } from '../../app';
import { createSession } from '../../auth/sessions';
import { upsertUserFromProfile } from '../../auth/passport';
import { FileModel } from '../../models/File';
import { PublicLinkModel } from '../../models/PublicLink';

describe('Public links routes', () => {
  let app: Application;
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;

  beforeAll(async () => {
    app = createApp();

    const owner = await upsertUserFromProfile({
      provider: 'google',
      id: 'pl-owner-001',
      email: 'plowner@example.com',
      displayName: 'PLOwner',
    });
    ownerId = owner._id.toString();
    const ownerSession = await createSession(ownerId);
    ownerCookie = `shard_token=${ownerSession}`;

    const other = await upsertUserFromProfile({
      provider: 'google',
      id: 'pl-other-001',
      email: 'plother@example.com',
      displayName: 'PLOther',
    });
    const otherSession = await createSession(other._id.toString());
    otherCookie = `shard_token=${otherSession}`;
  });

  // ── Helper ────────────────────────────────────────────────────────────────────
  async function createFile(name = 'public.txt') {
    return FileModel.create({
      userId: new Types.ObjectId(ownerId),
      name,
      path: name,
      mimeType: 'text/plain',
      size: 19,
      type: 'file' as const,
      encrypted: false,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/files/:id/public-link
  // ─────────────────────────────────────────────────────────────────────────────

  it('POST /api/files/:id/public-link — owner can create a public link', async () => {
    const file = await createFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 }); // 1 hour in seconds

    expect(res.status).toBe(201);
    expect(res.body.slug).toBeDefined();
    expect(res.body.slug).toMatch(/^[a-z]+-[a-z]+-\d+$/);
    expect(res.body.url).toContain(res.body.slug);
    expect(res.body.expiresAt).toBeDefined();
  });

  it('POST /api/files/:id/public-link — creates link with default expiry if none given', async () => {
    const file = await createFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.slug).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it('POST /api/files/:id/public-link — non-owner gets 403', async () => {
    const file = await createFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', otherCookie)
      .send({ expiresIn: 3600 });

    expect(res.status).toBe(403);
  });

  it('POST /api/files/:id/public-link — unauthenticated gets 401', async () => {
    const file = await createFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .send({ expiresIn: 3600 });

    expect(res.status).toBe(401);
  });

  it('POST /api/files/:id/public-link — returns 404 for unknown file', async () => {
    const res = await request(app)
      .post(`/api/files/${new Types.ObjectId()}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    expect(res.status).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/public-links
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/public-links — returns current user\'s links', async () => {
    const file1 = await createFile('link1.txt');
    const file2 = await createFile('link2.txt');

    await request(app)
      .post(`/api/files/${file1._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    await request(app)
      .post(`/api/files/${file2._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    const res = await request(app)
      .get('/api/public-links')
      .set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].slug).toBeDefined();
    expect(res.body[0].fileId).toBeDefined();
  });

  it('GET /api/public-links — returns empty for user with no links', async () => {
    const res = await request(app)
      .get('/api/public-links')
      .set('Cookie', otherCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/public-links/:id
  // ─────────────────────────────────────────────────────────────────────────────

  it('DELETE /api/public-links/:id — owner can delete their link', async () => {
    const file = await createFile();
    const createRes = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    const linkId = createRes.body._id;

    const res = await request(app)
      .delete(`/api/public-links/${linkId}`)
      .set('Cookie', ownerCookie);

    expect(res.status).toBe(200);

    const remaining = await PublicLinkModel.findById(linkId);
    expect(remaining).toBeNull();
  });

  it('DELETE /api/public-links/:id — non-owner gets 403', async () => {
    const file = await createFile();
    const createRes = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    const linkId = createRes.body._id;

    const res = await request(app)
      .delete(`/api/public-links/${linkId}`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(403);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/public/:slug (metadata, no auth)
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/public/:slug — returns file metadata anonymously', async () => {
    const file = await createFile('metadata.txt');
    const createRes = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    const slug = createRes.body.slug;

    const res = await request(app)
      .get(`/api/public/${slug}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('metadata.txt');
    expect(res.body.mimeType).toBe('text/plain');
    expect(res.body.size).toBe(19);
  });

  it('GET /api/public/:slug — returns 404 for unknown slug', async () => {
    const res = await request(app)
      .get('/api/public/nonexistent-slug-999');

    expect(res.status).toBe(404);
  });

  it('GET /api/public/:slug — returns 410 for expired link', async () => {
    const file = await createFile('expired.txt');

    // Create expired link directly in DB
    await PublicLinkModel.create({
      fileId: file._id,
      slug: 'expired-link-001',
      createdBy: new Types.ObjectId(ownerId),
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      downloadCount: 0,
    });

    const res = await request(app)
      .get('/api/public/expired-link-001');

    expect(res.status).toBe(410);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/public/:slug/download (no auth)
  // ─────────────────────────────────────────────────────────────────────────────

  it('GET /api/public/:slug/download — streams file bytes anonymously', async () => {
    const { readFile } = require('../../storage/storageService');
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('public-file-content'));

    const file = await createFile('download.txt');
    const createRes = await request(app)
      .post(`/api/files/${file._id}/public-link`)
      .set('Cookie', ownerCookie)
      .send({ expiresIn: 3600 });

    const slug = createRes.body.slug;

    const res = await request(app)
      .get(`/api/public/${slug}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('download.txt');
    expect(res.body).toBeDefined();
  });

  it('GET /api/public/:slug/download — returns 410 for expired link', async () => {
    const file = await createFile('expired-dl.txt');

    await PublicLinkModel.create({
      fileId: file._id,
      slug: 'expired-dl-001',
      createdBy: new Types.ObjectId(ownerId),
      expiresAt: new Date(Date.now() - 1000),
      downloadCount: 0,
    });

    const res = await request(app)
      .get('/api/public/expired-dl-001/download');

    expect(res.status).toBe(410);
  });

  it('GET /api/public/:slug/download — returns 404 for unknown slug', async () => {
    const res = await request(app)
      .get('/api/public/no-such-slug-xyz/download');

    expect(res.status).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Slug uniqueness
  // ─────────────────────────────────────────────────────────────────────────────

  it('slug generator produces unique slugs for multiple links', async () => {
    const file = await createFile('multi.txt');
    const slugs = new Set<string>();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/files/${file._id}/public-link`)
        .set('Cookie', ownerCookie)
        .send({ expiresIn: 3600 });

      expect(res.status).toBe(201);
      slugs.add(res.body.slug);
    }

    // All 5 should be unique
    expect(slugs.size).toBe(5);
  });
});

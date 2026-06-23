/**
 * Model tests — each model must:
 *  1. Create a valid document
 *  2. Enforce its unique index(es)
 *
 * Uses mongodb-memory-server so no real Atlas needed.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Models (imported after connection is set up)
import {
  UserModel,
  OrgKeyModel,
  StorageClusterModel,
  FileModel,
  BlobModel,
  ApiKeyModel,
  SessionModel,
  ShareModel,
  PublicLinkModel,
  InviteModel,
} from '../index';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();

  // Rebind models to the in-memory connection
  // (models are defined with a factory pattern accepting a connection)
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

// Helper to get a connection-bound model
function bound<T>(model: mongoose.Model<T>): mongoose.Model<T> {
  return conn.model<T>(model.modelName, model.schema);
}

// ── User ─────────────────────────────────────────────────────────────────────

describe('User model', () => {
  let User: mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;

  beforeAll(async () => {
    User = bound(UserModel);
    await User.createIndexes();
  });

  it('creates a valid user', async () => {
    const user = await User.create({
      provider: 'google',
      providerId: 'g-001',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    expect(user._id).toBeDefined();
    expect(user.role).toBe('user'); // default
  });

  it('defaults status to pending', async () => {
    const user = await User.create({
      provider: 'google',
      providerId: 'g-status-001',
      email: 'pending@example.com',
      displayName: 'Pending User',
    });
    expect(user.status).toBe('pending');
  });

  it('can create a user with status active', async () => {
    const user = await User.create({
      provider: 'github',
      providerId: 'gh-status-001',
      email: 'active@example.com',
      displayName: 'Active User',
      status: 'active',
    });
    expect(user.status).toBe('active');
  });

  it('can change status from pending to active', async () => {
    const user = await User.create({
      provider: 'google',
      providerId: 'g-status-002',
      email: 'will-be-active@example.com',
      displayName: 'Soon Active',
    });
    expect(user.status).toBe('pending');
    await User.updateOne({ _id: user._id }, { status: 'active' });
    const updated = await User.findById(user._id).lean();
    expect(updated?.status).toBe('active');
  });

  it('enforces unique (provider, providerId)', async () => {
    await User.create({ provider: 'google', providerId: 'g-dup', email: 'b@x.com', displayName: 'B' });
    await expect(
      User.create({ provider: 'google', providerId: 'g-dup', email: 'c@x.com', displayName: 'C' })
    ).rejects.toThrow(/duplicate key/i);
  });
});

// ── OrgKey ────────────────────────────────────────────────────────────────────

describe('OrgKey model', () => {
  let OrgKey: mongoose.Model<mongoose.InferSchemaType<typeof OrgKeyModel.schema>>;

  beforeAll(async () => {
    OrgKey = bound(OrgKeyModel);
    await OrgKey.createIndexes();
  });

  it('creates a valid org key', async () => {
    const userId = new mongoose.Types.ObjectId();
    const key = await OrgKey.create({
      userId,
      label: 'My Org',
      publicKey: 'pub-001',
      privateKey: 'priv-001',
      orgId: 'org-abc',
    });
    expect(key._id).toBeDefined();
    expect(key.clusterCount).toBe(0);
  });
});

// ── StorageCluster ────────────────────────────────────────────────────────────

describe('StorageCluster model', () => {
  let SC: mongoose.Model<mongoose.InferSchemaType<typeof StorageClusterModel.schema>>;

  beforeAll(async () => {
    SC = bound(StorageClusterModel);
    await SC.createIndexes();
  });

  it('creates a valid storage cluster', async () => {
    const userId = new mongoose.Types.ObjectId();
    const orgKeyId = new mongoose.Types.ObjectId();
    const cluster = await SC.create({
      userId,
      orgKeyId,
      clusterId: 'cluster-001',
      projectId: 'proj-001',
      clusterName: 'shard-u1-1',
      connectionUri: 'mongodb+srv://user:pass@cluster.mongodb.net/shard',
      status: 'active',
    });
    expect(cluster.storageUsedBytes).toBe(0);
    expect(cluster.storageCapacityBytes).toBe(512 * 1024 * 1024);
  });
});

// ── File ─────────────────────────────────────────────────────────────────────

describe('File model', () => {
  let File: mongoose.Model<mongoose.InferSchemaType<typeof FileModel.schema>>;

  beforeAll(async () => {
    File = bound(FileModel);
    await File.createIndexes();
  });

  it('creates a valid file document', async () => {
    const userId = new mongoose.Types.ObjectId();
    const file = await File.create({
      userId,
      name: 'photo.jpg',
      path: '/photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      type: 'file',
    });
    expect(file._id).toBeDefined();
    expect(file.starred).toBe(false);
  });

  it('enforces unique (userId, path)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await File.create({ userId, name: 'dup.txt', path: '/dup.txt', mimeType: 'text/plain', size: 10, type: 'file' });
    await expect(
      File.create({ userId, name: 'dup.txt', path: '/dup.txt', mimeType: 'text/plain', size: 10, type: 'file' })
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows the same path for different users', async () => {
    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();
    await File.create({ userId: u1, name: 'a.txt', path: '/a.txt', mimeType: 'text/plain', size: 1, type: 'file' });
    const doc = await File.create({ userId: u2, name: 'a.txt', path: '/a.txt', mimeType: 'text/plain', size: 1, type: 'file' });
    expect(doc._id).toBeDefined();
  });
});

// ── Blob ─────────────────────────────────────────────────────────────────────

describe('Blob model', () => {
  let Blob: mongoose.Model<mongoose.InferSchemaType<typeof BlobModel.schema>>;

  beforeAll(async () => {
    Blob = bound(BlobModel);
    await Blob.createIndexes();
  });

  it('creates a valid blob', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const clusterId = new mongoose.Types.ObjectId();
    const blob = await Blob.create({
      fileId,
      clusterId,
      gridfsId: new mongoose.Types.ObjectId(),
      index: 0,
      size: 4096,
    });
    expect(blob._id).toBeDefined();
  });

  it('enforces unique (fileId, index)', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const clusterId = new mongoose.Types.ObjectId();
    await Blob.create({ fileId, clusterId, gridfsId: new mongoose.Types.ObjectId(), index: 0, size: 100 });
    await expect(
      Blob.create({ fileId, clusterId, gridfsId: new mongoose.Types.ObjectId(), index: 0, size: 100 })
    ).rejects.toThrow(/duplicate key/i);
  });
});

// ── ApiKey ────────────────────────────────────────────────────────────────────

describe('ApiKey model', () => {
  let ApiKey: mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>>;

  beforeAll(async () => {
    ApiKey = bound(ApiKeyModel);
    await ApiKey.createIndexes();
  });

  it('creates a valid API key', async () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = await ApiKey.create({ userId, key: 'shard_abc123', label: 'CLI' });
    expect(doc._id).toBeDefined();
    expect(doc.lastUsed).toBeNull();
  });

  it('enforces unique key', async () => {
    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();
    await ApiKey.create({ userId: u1, key: 'shard_dup_key', label: 'A' });
    await expect(ApiKey.create({ userId: u2, key: 'shard_dup_key', label: 'B' })).rejects.toThrow(/duplicate key/i);
  });
});

// ── Session ───────────────────────────────────────────────────────────────────

describe('Session model', () => {
  let Session: mongoose.Model<mongoose.InferSchemaType<typeof SessionModel.schema>>;

  beforeAll(async () => {
    Session = bound(SessionModel);
    await Session.createIndexes();
  });

  it('creates a valid session', async () => {
    const userId = new mongoose.Types.ObjectId();
    const expiresAt = new Date(Date.now() + 86400_000);
    const doc = await Session.create({ userId, token: 'tok-001', expiresAt });
    expect(doc._id).toBeDefined();
  });

  it('enforces unique token', async () => {
    const u = new mongoose.Types.ObjectId();
    const exp = new Date(Date.now() + 86400_000);
    await Session.create({ userId: u, token: 'tok-dup', expiresAt: exp });
    await expect(Session.create({ userId: u, token: 'tok-dup', expiresAt: exp })).rejects.toThrow(/duplicate key/i);
  });
});

// ── Share ─────────────────────────────────────────────────────────────────────

describe('Share model', () => {
  let Share: mongoose.Model<mongoose.InferSchemaType<typeof ShareModel.schema>>;

  beforeAll(async () => {
    Share = bound(ShareModel);
    await Share.createIndexes();
  });

  it('creates a valid share', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const sharedWithId = new mongoose.Types.ObjectId();
    const doc = await Share.create({ fileId, sharedWithId, permission: 'view' });
    expect(doc._id).toBeDefined();
  });

  it('enforces unique (fileId, sharedWithId)', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const sharedWithId = new mongoose.Types.ObjectId();
    await Share.create({ fileId, sharedWithId, permission: 'view' });
    await expect(Share.create({ fileId, sharedWithId, permission: 'edit' })).rejects.toThrow(/duplicate key/i);
  });
});

// ── Config ────────────────────────────────────────────────────────────────────

describe('Config model', () => {
  let BoundConfig: mongoose.Model<any>;

  beforeAll(async () => {
    const { ConfigModel } = await import('../Config');
    try {
      BoundConfig = conn.model(ConfigModel.modelName);
    } catch {
      BoundConfig = conn.model(ConfigModel.modelName, ConfigModel.schema);
    }
    await BoundConfig.createIndexes();
    await BoundConfig.deleteMany({});
  });

  it('creates a singleton Config document', async () => {
    const doc = await BoundConfig.create({
      key: 'singleton',
      jwtSecret: 'testsecret',
      googleClientId: 'gid',
    });

    expect(doc.key).toBe('singleton');
    expect(doc.jwtSecret).toBe('testsecret');
    expect(doc.googleClientId).toBe('gid');
    expect(doc.updatedAt).toBeDefined();
  });

  it('enforces unique key constraint', async () => {
    await BoundConfig.deleteMany({});
    await BoundConfig.create({ key: 'singleton', jwtSecret: 'secret1' });
    await expect(
      BoundConfig.create({ key: 'singleton', jwtSecret: 'secret2' })
    ).rejects.toThrow();
  });
});

// ── PublicLink ─────────────────────────────────────────────────────────────────

describe('PublicLink model', () => {
  let PublicLink: mongoose.Model<mongoose.InferSchemaType<typeof PublicLinkModel.schema>>;

  beforeAll(async () => {
    PublicLink = bound(PublicLinkModel);
    await PublicLink.createIndexes();
  });

  it('creates a valid public link', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const doc = await PublicLink.create({ fileId, slug: 'abc-xyz-123', createdBy, expiresAt });
    expect(doc._id).toBeDefined();
  });

  it('enforces unique slug', async () => {
    const fileId = new mongoose.Types.ObjectId();
    const cb = new mongoose.Types.ObjectId();
    const exp = new Date(Date.now() + 86400_000);
    await PublicLink.create({ fileId, slug: 'dup-slug', createdBy: cb, expiresAt: exp });
    await expect(
      PublicLink.create({ fileId, slug: 'dup-slug', createdBy: cb, expiresAt: exp })
    ).rejects.toThrow(/duplicate key/i);
  });
});

// ── Invite ─────────────────────────────────────────────────────────────────────

describe('Invite model', () => {
  let Invite: mongoose.Model<mongoose.InferSchemaType<typeof InviteModel.schema>>;

  beforeAll(async () => {
    Invite = bound(InviteModel);
    await Invite.createIndexes();
  });

  it('creates a valid invite', async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const doc = await Invite.create({ email: 'invite@example.com', createdBy });
    expect(doc._id).toBeDefined();
    expect(doc.email).toBe('invite@example.com');
    expect(doc.createdBy.toString()).toBe(createdBy.toString());
  });

  it('lowercases the email', async () => {
    const createdBy = new mongoose.Types.ObjectId();
    const doc = await Invite.create({ email: 'UPPER@EXAMPLE.COM', createdBy });
    expect(doc.email).toBe('upper@example.com');
  });

  it('enforces unique email', async () => {
    const cb = new mongoose.Types.ObjectId();
    await Invite.create({ email: 'dup-invite@example.com', createdBy: cb });
    await expect(
      Invite.create({ email: 'dup-invite@example.com', createdBy: cb })
    ).rejects.toThrow(/duplicate key/i);
  });

  it('can find and delete an invite by email', async () => {
    const cb = new mongoose.Types.ObjectId();
    await Invite.create({ email: 'findme@example.com', createdBy: cb });
    const found = await Invite.findOne({ email: 'findme@example.com' }).lean();
    expect(found).not.toBeNull();
    await Invite.deleteOne({ email: 'findme@example.com' });
    const gone = await Invite.findOne({ email: 'findme@example.com' }).lean();
    expect(gone).toBeNull();
  });
});

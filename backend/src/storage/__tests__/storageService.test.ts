/**
 * Storage service tests — Phase 4.2
 *
 * Strategy: We inject fake `getBucket` and `ensureCapacity` implementations that
 * return real GridFSBucket instances backed by mongodb-memory-server instances,
 * so we exercise real GridFS I/O without Atlas.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { FileModel } from '../../models/File';
import { BlobModel } from '../../models/Blob';
import { StorageClusterModel, type IStorageCluster } from '../../models/StorageCluster';
import { generateEncryptionKey } from '../../utils/crypto';
import { USABLE_BYTES } from '../clusterManager';

// ---- helpers ----------------------------------------------------------------

/** Creates a real in-memory Mongo instance with a GridFS bucket. */
async function makeFakeCluster(starterConn: mongoose.Connection) {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const conn = await mongoose.createConnection(uri).asPromise();
  const bucket = new mongoose.mongo.GridFSBucket(conn.db!, { bucketName: 'shard-files' });

  // Persist a StorageCluster doc on the starter connection so we can look it up
  const clusterDoc = await StorageClusterModel.create({
    userId: new Types.ObjectId(), // overridden per-test
    orgKeyId: new Types.ObjectId(),
    clusterId: `test-cluster-${Date.now()}-${Math.random()}`,
    projectId: 'test-project',
    clusterName: 'test-cluster',
    connectionUri: uri,
    status: 'active',
    storageUsedBytes: 0,
    storageCapacityBytes: 512 * 1024 * 1024,
  });

  return { mongod, conn, bucket, clusterDoc };
}

// ---- Module-level state -----------------------------------------------------

let starterMongod: MongoMemoryServer;
let starterConn: mongoose.Connection;

// We'll import the service after we set up stubs via jest.mock
let storeFile: typeof import('../storageService').storeFile;
let readFile: typeof import('../storageService').readFile;
let deleteFileBytes: typeof import('../storageService').deleteFileBytes;

// Buckets keyed by clusterId STRING
const bucketRegistry = new Map<string, InstanceType<typeof mongoose.mongo.GridFSBucket>>();
// ensureCapacity mock: returns a cluster doc from the registry
let ensureCapacityMock: jest.Mock;

jest.mock('../clusterManager', () => ({
  ...jest.requireActual('../clusterManager'),
  getBucket: (clusterId: string) => bucketRegistry.get(clusterId) ?? null,
}));

jest.mock('../provisioner', () => ({
  ensureCapacity: (...args: unknown[]) => ensureCapacityMock(...args),
}));

// ---- Setup / teardown -------------------------------------------------------

beforeAll(async () => {
  starterMongod = await MongoMemoryServer.create();
  starterConn = await mongoose.createConnection(starterMongod.getUri()).asPromise();
  // Wire mongoose's default connection to the starter so models work
  await mongoose.connect(starterMongod.getUri());

  // Import AFTER mocks are registered
  const mod = await import('../storageService');
  storeFile = mod.storeFile;
  readFile = mod.readFile;
  deleteFileBytes = mod.deleteFileBytes;
});

afterAll(async () => {
  await mongoose.disconnect();
  await starterConn.close();
  await starterMongod.stop();
  // Clean up any cluster mongods created in tests
});

afterEach(async () => {
  await FileModel.deleteMany({});
  await BlobModel.deleteMany({});
  await StorageClusterModel.deleteMany({});
  bucketRegistry.clear();
  jest.clearAllMocks();
});

// ---- Helpers ----------------------------------------------------------------

const TEST_USER_ID = new Types.ObjectId().toString();

async function makeClusterForUser(userId: string, usedBytes = 0) {
  const { mongod, conn, bucket, clusterDoc } = await makeFakeCluster(starterConn);

  // Update the doc to belong to our user
  await StorageClusterModel.findByIdAndUpdate(clusterDoc._id, {
    userId: new Types.ObjectId(userId),
    storageUsedBytes: usedBytes,
  });
  const updated = (await StorageClusterModel.findById(clusterDoc._id))!;

  bucketRegistry.set(updated.clusterId, bucket);

  return { mongod, conn, bucket, clusterDoc: updated };
}

// ---- Tests ------------------------------------------------------------------

describe('storeFile', () => {
  it('single-cluster: stores bytes in GridFS and creates File + Blob docs', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    const content = Buffer.from('Hello, Shard!');
    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'hello.txt',
      buffer: content,
      mimeType: 'text/plain',
      encrypt: false,
    });

    expect(file).toBeTruthy();
    expect(file!.name).toBe('hello.txt');
    expect(file!.size).toBe(content.length);
    expect(file!.encrypted).toBe(false);
    expect(file!.type).toBe('file');
    expect(file!.path).toBe('/hello.txt');

    const blobs = await BlobModel.find({ fileId: file!._id });
    expect(blobs).toHaveLength(1);
    expect(blobs[0].index).toBe(0);
    expect(blobs[0].size).toBe(content.length);
    expect(blobs[0].clusterId.toString()).toBe(clusterDoc._id.toString());
  });

  it('creates File with encrypted=true when encrypt flag set', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);
    const key = generateEncryptionKey();

    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'secret.txt',
      buffer: Buffer.from('top secret'),
      mimeType: 'text/plain',
      encrypt: true,
      encryptionKey: key,
    });

    expect(file!.encrypted).toBe(true);
    const blobs = await BlobModel.find({ fileId: file!._id });
    // Blob size should be larger due to encryption overhead
    expect(blobs[0].size).toBeGreaterThan('top secret'.length);
  });

  it('deduplicates name when collision exists', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'report.txt',
      buffer: Buffer.from('v1'),
      mimeType: 'text/plain',
      encrypt: false,
    });

    const file2 = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'report.txt',
      buffer: Buffer.from('v2'),
      mimeType: 'text/plain',
      encrypt: false,
    });

    expect(file2!.name).toBe('report (1).txt');
    expect(file2!.path).toBe('/report (1).txt');
  });

  it('multi-cluster split: creates multiple Blobs across clusters when file exceeds remaining space', async () => {
    // First cluster is nearly full — only 100 bytes remain
    const { clusterDoc: cluster1 } = await makeClusterForUser(TEST_USER_ID, USABLE_BYTES - 100);
    const { clusterDoc: cluster2 } = await makeClusterForUser(TEST_USER_ID, 0);

    let callCount = 0;
    ensureCapacityMock = jest.fn().mockImplementation(async (_userId: string, _neededBytes: number) => {
      callCount += 1;
      if (callCount === 1) return cluster1;
      return cluster2;
    });

    // 200-byte file that can't fit in cluster1's 100-byte remainder
    const content = Buffer.alloc(200, 0xab);
    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'big.bin',
      buffer: content,
      mimeType: 'application/octet-stream',
      encrypt: false,
    });

    expect(file).toBeTruthy();
    expect(file!.size).toBe(200);

    const blobs = await BlobModel.find({ fileId: file!._id }).sort({ index: 1 });
    expect(blobs.length).toBeGreaterThanOrEqual(2);
    expect(blobs[0].clusterId.toString()).toBe(cluster1._id.toString());
    expect(blobs[1].clusterId.toString()).toBe(cluster2._id.toString());

    // Total blob bytes = file size
    const totalBlobBytes = blobs.reduce((sum, b) => sum + b.size, 0);
    expect(totalBlobBytes).toBe(200);
  });

  it('updates storageUsedBytes on the cluster after storing', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID, 0);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    const content = Buffer.from('some bytes here');
    await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'track.txt',
      buffer: content,
      mimeType: 'text/plain',
      encrypt: false,
    });

    const updated = await StorageClusterModel.findById(clusterDoc._id);
    expect(updated!.storageUsedBytes).toBeGreaterThan(0);
  });
});

describe('readFile', () => {
  it('single-cluster: returns original bytes', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    const content = Buffer.from('roundtrip content');
    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'rt.txt',
      buffer: content,
      mimeType: 'text/plain',
      encrypt: false,
    });

    const result = await readFile(file!._id.toString());
    expect(result).toEqual(content);
  });

  it('encrypted: decrypts transparently', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);
    const key = generateEncryptionKey();

    const content = Buffer.from('encrypted roundtrip');
    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'enc.txt',
      buffer: content,
      mimeType: 'text/plain',
      encrypt: true,
      encryptionKey: key,
    });

    const result = await readFile(file!._id.toString(), key);
    expect(result).toEqual(content);
  });

  it('multi-cluster: reassembles bytes in correct order', async () => {
    const { clusterDoc: cluster1 } = await makeClusterForUser(TEST_USER_ID, USABLE_BYTES - 100);
    const { clusterDoc: cluster2 } = await makeClusterForUser(TEST_USER_ID, 0);

    let callCount = 0;
    ensureCapacityMock = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount === 1 ? cluster1 : cluster2;
    });

    // Create distinguishable content: first 100 bytes = 0xAA, next 100 = 0xBB
    const part1 = Buffer.alloc(100, 0xaa);
    const part2 = Buffer.alloc(100, 0xbb);
    const content = Buffer.concat([part1, part2]);

    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'split.bin',
      buffer: content,
      mimeType: 'application/octet-stream',
      encrypt: false,
    });

    const result = await readFile(file!._id.toString());
    expect(result).toEqual(content);
  });

  it('throws when file not found', async () => {
    await expect(readFile(new Types.ObjectId().toString())).rejects.toThrow();
  });
});

describe('deleteFileBytes', () => {
  it('removes GridFS objects and Blob docs, decrements storageUsedBytes', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID, 0);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    const content = Buffer.from('to be deleted');
    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'gone.txt',
      buffer: content,
      mimeType: 'text/plain',
      encrypt: false,
    });

    const fileId = file!._id.toString();
    await deleteFileBytes(fileId);

    const remaining = await BlobModel.find({ fileId: file!._id });
    expect(remaining).toHaveLength(0);

    // storageUsedBytes should be back to 0
    const cluster = await StorageClusterModel.findById(clusterDoc._id);
    expect(cluster!.storageUsedBytes).toBe(0);
  });

  it('is idempotent — second call does not throw', async () => {
    const { clusterDoc } = await makeClusterForUser(TEST_USER_ID, 0);
    ensureCapacityMock = jest.fn().mockResolvedValue(clusterDoc);

    const file = await storeFile({
      userId: TEST_USER_ID,
      parentId: null,
      name: 'idempotent.txt',
      buffer: Buffer.from('x'),
      mimeType: 'text/plain',
      encrypt: false,
    });

    const fileId = file!._id.toString();
    await deleteFileBytes(fileId);
    await expect(deleteFileBytes(fileId)).resolves.not.toThrow();
  });
});

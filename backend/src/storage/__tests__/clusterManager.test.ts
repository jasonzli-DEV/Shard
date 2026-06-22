import { Types } from 'mongoose';

// We need to mock mongoose and the StorageClusterModel before importing clusterManager
jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  return {
    ...actual,
    createConnection: jest.fn(),
  };
});

jest.mock('../../models', () => ({
  StorageClusterModel: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

import mongoose from 'mongoose';
import { StorageClusterModel } from '../../models';
import {
  openCluster,
  getBucket,
  getActiveCluster,
  runStorageCheck,
  keepalive,
  closeCluster,
  closeAll,
} from '../clusterManager';

const mockCreateConnection = mongoose.createConnection as jest.Mock;
const mockStorageClusterModel = StorageClusterModel as jest.Mocked<typeof StorageClusterModel>;

function makeDbStub(dataSize: number, indexSize: number) {
  return {
    command: jest.fn(async (cmd: Record<string, unknown>) => {
      if (cmd['dbStats']) return { dataSize, indexSize };
      return {};
    }),
  };
}

function makeConnStub(db: ReturnType<typeof makeDbStub>) {
  return {
    db,
    asPromise: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
}

const userId = new Types.ObjectId().toString();

describe('clusterManager', () => {
  beforeEach(() => {
    closeAll();
    mockCreateConnection.mockReset();
    (mockStorageClusterModel.findOne as jest.Mock).mockReset();
    (mockStorageClusterModel.findOneAndUpdate as jest.Mock).mockReset();
  });

  describe('openCluster', () => {
    it('creates a mongoose connection for a new cluster entry', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-001',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };

      await openCluster(entry);

      expect(mockCreateConnection).toHaveBeenCalledWith('mongodb+srv://u:p@host/db');
      expect(conn.asPromise).toHaveBeenCalled();
    });

    it('does not open a second connection for the same clusterId', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-dup',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };

      await openCluster(entry);
      await openCluster(entry); // second call — should be no-op

      expect(mockCreateConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBucket', () => {
    it('returns a GridFSBucket for an open cluster', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);

      // GridFSBucket needs a real-ish db reference; we mock the mongo.GridFSBucket
      const MockGridFSBucket = jest.fn().mockImplementation(() => ({ fake: 'bucket' }));
      jest.spyOn(mongoose.mongo, 'GridFSBucket').mockImplementation(MockGridFSBucket);

      mockCreateConnection.mockReturnValue({ ...conn, db: { ...db } });

      const entry = {
        clusterId: 'cluster-gfs',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };

      await openCluster(entry);
      const bucket = getBucket('cluster-gfs');

      expect(bucket).toBeDefined();
      expect(MockGridFSBucket).toHaveBeenCalled();
    });

    it('returns null for an unknown clusterId', () => {
      expect(getBucket('nonexistent')).toBeNull();
    });

    it('caches the GridFSBucket on repeated calls', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      const MockGridFSBucket = jest.fn().mockImplementation(() => ({ fake: 'bucket' }));
      jest.spyOn(mongoose.mongo, 'GridFSBucket').mockImplementation(MockGridFSBucket);

      mockCreateConnection.mockReturnValue({ ...conn, db: { ...db } });

      const entry = {
        clusterId: 'cluster-cache',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };

      await openCluster(entry);
      getBucket('cluster-cache');
      getBucket('cluster-cache');

      // GridFSBucket constructor should only be called once
      expect(MockGridFSBucket).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActiveCluster', () => {
    it('returns the active StorageCluster document for a user', async () => {
      const mockCluster = {
        clusterId: 'cluster-active',
        status: 'active',
        userId,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(mockCluster);

      const result = await getActiveCluster(userId);

      expect(result).toEqual(mockCluster);
      expect(mockStorageClusterModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('returns null when no active cluster exists for user', async () => {
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await getActiveCluster(userId);
      expect(result).toBeNull();
    });
  });

  describe('runStorageCheck', () => {
    // STORAGE_LIMIT_BYTES = 512MB, SAFETY_MARGIN_BYTES = 20MB, USABLE_BYTES = 492MB
    // PREWARM_THRESHOLD = 0.90 of USABLE_BYTES = 442.8MB
    const STORAGE_LIMIT = 512 * 1024 * 1024;
    const SAFETY_MARGIN = 20 * 1024 * 1024;
    const USABLE = STORAGE_LIMIT - SAFETY_MARGIN; // 492MB

    it('returns atThreshold=false when storage is below 90% of USABLE_BYTES', async () => {
      // 50% of USABLE — well below prewarm threshold
      const used = Math.floor(USABLE * 0.5);
      const dataSize = Math.floor(used * 0.7);
      const indexSize = used - dataSize;

      const db = makeDbStub(dataSize, indexSize);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-check-low',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      const mockCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-check-low',
        userId,
        status: 'active',
        storageUsedBytes: 0,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(mockCluster);
      (mockStorageClusterModel.findOneAndUpdate as jest.Mock).mockResolvedValue(mockCluster);

      const result = await runStorageCheck(userId);

      expect(result.checked).toBe(true);
      expect(result.atThreshold).toBe(false);
      expect(result.usedBytes).toBe(dataSize + indexSize);
    });

    it('returns atThreshold=true when storage is at or above 90% of USABLE_BYTES (pre-warm threshold)', async () => {
      // 91% of USABLE — above PREWARM_THRESHOLD
      const used = Math.floor(USABLE * 0.91);
      const dataSize = Math.floor(used * 0.7);
      const indexSize = used - dataSize;

      const db = makeDbStub(dataSize, indexSize);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-check-high',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      const mockCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-check-high',
        userId,
        status: 'active',
        storageUsedBytes: 0,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(mockCluster);
      (mockStorageClusterModel.findOneAndUpdate as jest.Mock).mockResolvedValue(mockCluster);

      const result = await runStorageCheck(userId);

      expect(result.checked).toBe(true);
      expect(result.atThreshold).toBe(true);
      // 91% of 492MB is well above 90% of 492MB
      expect(result.usedBytes).toBeGreaterThanOrEqual(USABLE * 0.9);
    });

    it('returns atThreshold=false when storage is between 80% of LIMIT and 90% of USABLE (packs without pre-warming)', async () => {
      // 82% of STORAGE_LIMIT ≈ 419MB, but USABLE is 492MB so 0.9*492≈442MB — below pre-warm
      const used = Math.floor(STORAGE_LIMIT * 0.82);
      const dataSize = Math.floor(used * 0.7);
      const indexSize = used - dataSize;

      const db = makeDbStub(dataSize, indexSize);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-check-mid',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      const mockCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-check-mid',
        userId,
        status: 'active',
        storageUsedBytes: 0,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(mockCluster);
      (mockStorageClusterModel.findOneAndUpdate as jest.Mock).mockResolvedValue(mockCluster);

      const result = await runStorageCheck(userId);

      expect(result.checked).toBe(true);
      // 82% of 512MB = 419MB < 90% of 492MB = 442.8MB, so NOT at prewarm threshold
      expect(result.atThreshold).toBe(false);
    });

    it('returns checked=false when no active cluster connection found', async () => {
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await runStorageCheck(userId);
      expect(result.checked).toBe(false);
    });

    it('persists storageUsedBytes to the StorageCluster document', async () => {
      const LIMIT = 512 * 1024 * 1024;
      const dataSize = 100_000;
      const indexSize = 50_000;

      const db = makeDbStub(dataSize, indexSize);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-persist',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      const mockCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-persist',
        userId,
        status: 'active',
        storageUsedBytes: 0,
        storageCapacityBytes: LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(mockCluster);
      (mockStorageClusterModel.findOneAndUpdate as jest.Mock).mockResolvedValue(mockCluster);

      await runStorageCheck(userId);

      expect(mockStorageClusterModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ clusterId: 'cluster-persist' }),
        expect.objectContaining({ storageUsedBytes: dataSize + indexSize }),
        expect.anything(),
      );
    });
  });

  describe('keepalive', () => {
    it('calls ping on all open connections without throwing', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-ping',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      // Should not throw
      await expect(keepalive()).resolves.not.toThrow();
      expect(db.command).toHaveBeenCalledWith({ ping: 1 });
    });
  });

  describe('closeCluster', () => {
    it('closes a single cluster connection and removes it from caches', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-single-close',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      await closeCluster('cluster-single-close');

      expect(conn.close).toHaveBeenCalled();
      expect(getBucket('cluster-single-close')).toBeNull();
    });

    it('is a no-op for an unknown clusterId', async () => {
      // Should not throw
      await expect(closeCluster('nonexistent-cluster')).resolves.not.toThrow();
    });
  });

  describe('closeAll', () => {
    it('closes all open connections and clears caches', async () => {
      const db = makeDbStub(0, 0);
      const conn = makeConnStub(db);
      mockCreateConnection.mockReturnValue(conn);

      const entry = {
        clusterId: 'cluster-close',
        connectionUri: 'mongodb+srv://u:p@host/db',
        userId,
        status: 'active' as const,
      };
      await openCluster(entry);

      await closeAll();

      expect(conn.close).toHaveBeenCalled();
      // After closeAll, getBucket should return null
      expect(getBucket('cluster-close')).toBeNull();
    });
  });
});

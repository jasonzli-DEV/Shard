import { Types } from 'mongoose';

jest.mock('../../models', () => ({
  OrgKeyModel: {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  StorageClusterModel: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../atlas/client', () => ({
  makeAtlasClient: jest.fn(),
}));

jest.mock('../clusterManager', () => ({
  openCluster: jest.fn(),
  getActiveCluster: jest.fn(),
  runStorageCheck: jest.fn(),
  STORAGE_LIMIT_BYTES: 512 * 1024 * 1024,
  SAFETY_MARGIN_BYTES: 20 * 1024 * 1024,
  USABLE_BYTES: (512 - 20) * 1024 * 1024, // 492MB
}));

import { OrgKeyModel, StorageClusterModel } from '../../models';
import { makeAtlasClient } from '../../atlas/client';
import { getActiveCluster, runStorageCheck } from '../clusterManager';
import { provisionNextCluster, ensureCapacity } from '../provisioner';

const mockOrgKeyModel = OrgKeyModel as jest.Mocked<typeof OrgKeyModel>;
const mockStorageClusterModel = StorageClusterModel as jest.Mocked<typeof StorageClusterModel>;
const mockMakeAtlasClient = makeAtlasClient as jest.MockedFunction<typeof makeAtlasClient>;
const mockGetActiveCluster = getActiveCluster as jest.MockedFunction<typeof getActiveCluster>;
const mockRunStorageCheck = runStorageCheck as jest.MockedFunction<typeof runStorageCheck>;

const userId = new Types.ObjectId().toString();

function makeOrgKey(overrides: Partial<{
  _id: Types.ObjectId;
  orgId: string;
  publicKey: string;
  privateKey: string;
  clusterCount: number;
}> = {}) {
  return {
    _id: overrides._id ?? new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    label: 'My Org',
    orgId: overrides.orgId ?? 'org-123',
    publicKey: overrides.publicKey ?? 'pub-key',
    privateKey: overrides.privateKey ?? 'priv-key',
    clusterCount: overrides.clusterCount ?? 0,
  };
}

function makeAtlasClientMock() {
  return {
    createProject: jest.fn(async (orgId: string, name: string) => ({ id: `proj-${name}`, name })),
    createCluster: jest.fn(async () => ({ stateName: 'CREATING' })),
    waitForCluster: jest.fn(async () => ({
      stateName: 'IDLE',
      connectionStrings: { standardSrv: 'mongodb+srv://cluster.abc.mongodb.net' },
    })),
    createDatabaseUser: jest.fn(async () => ({})),
    addIpAllowlist: jest.fn(async () => ({})),
    buildConnectionUri: jest.fn(
      (srvHost: string, user: string, pass: string, db: string) =>
        `mongodb+srv://${user}:${pass}@cluster.abc.mongodb.net/${db}?retryWrites=true&w=majority`,
    ),
    withOrgApiAccessListRetry: jest.fn(async (_orgId: string, op: () => Promise<unknown>) => op()),
    apiGet: jest.fn(),
    apiPost: jest.fn(),
    apiPatch: jest.fn(),
    discoverOrgId: jest.fn(),
    parseCredentialsFromUri: jest.fn(),
    addOrgApiKeyAccessList: jest.fn(),
    extractRequiredAccessListIp: jest.fn(),
  };
}

describe('provisioner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('provisionNextCluster', () => {
    it('happy path: creates project, cluster, user, allowlist and saves StorageCluster', async () => {
      const orgKey = makeOrgKey({ clusterCount: 5 });
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([orgKey]);

      const atlasClient = makeAtlasClientMock();
      mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(null); // no prior active
      (mockStorageClusterModel.updateMany as jest.Mock).mockResolvedValue({});
      (mockStorageClusterModel.create as jest.Mock).mockResolvedValue({
        clusterId: 'shard-user-6',
        status: 'active',
      });
      (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      const result = await provisionNextCluster(userId);

      expect(atlasClient.createProject).toHaveBeenCalled();
      expect(atlasClient.createCluster).toHaveBeenCalled();
      expect(atlasClient.waitForCluster).toHaveBeenCalled();
      expect(atlasClient.createDatabaseUser).toHaveBeenCalled();
      expect(atlasClient.addIpAllowlist).toHaveBeenCalled();
      expect(mockStorageClusterModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          userId: expect.anything(),
          connectionUri: expect.stringContaining('mongodb+srv://'),
        }),
      );
      expect(mockOrgKeyModel.findByIdAndUpdate).toHaveBeenCalledWith(
        orgKey._id,
        expect.objectContaining({ $inc: { clusterCount: 1 } }),
      );
      expect(result).toBeDefined();
    });

    it('demotes prior active cluster before activating new one', async () => {
      const orgKey = makeOrgKey({ clusterCount: 1 });
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([orgKey]);

      const atlasClient = makeAtlasClientMock();
      mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

      const priorActive = {
        _id: new Types.ObjectId(),
        clusterId: 'old-cluster',
        status: 'active',
        userId,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(priorActive);
      (mockStorageClusterModel.updateMany as jest.Mock).mockResolvedValue({});
      (mockStorageClusterModel.create as jest.Mock).mockResolvedValue({
        clusterId: 'new-cluster',
        status: 'active',
      });
      (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await provisionNextCluster(userId);

      // Should demote prior active clusters
      expect(mockStorageClusterModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: expect.anything(), status: 'active' }),
        expect.objectContaining({ status: 'full' }),
      );
    });

    it('rolls over to next OrgKey when current org is at cap (~250)', async () => {
      const fullOrg = makeOrgKey({ orgId: 'org-full', clusterCount: 250 });
      const nextOrg = makeOrgKey({ orgId: 'org-next', clusterCount: 3 });
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([fullOrg, nextOrg]);

      const atlasClient = makeAtlasClientMock();
      mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(null);
      (mockStorageClusterModel.updateMany as jest.Mock).mockResolvedValue({});
      (mockStorageClusterModel.create as jest.Mock).mockResolvedValue({
        clusterId: 'shard-user-4',
        status: 'active',
      });
      (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await provisionNextCluster(userId);

      // Should have used the second org key (nextOrg)
      expect(mockMakeAtlasClient).toHaveBeenCalledWith({
        publicKey: nextOrg.publicKey,
        privateKey: nextOrg.privateKey,
      });
    });

    it('throws STORAGE_FULL error when no org key has capacity', async () => {
      const fullOrg1 = makeOrgKey({ orgId: 'org-1', clusterCount: 250 });
      const fullOrg2 = makeOrgKey({ orgId: 'org-2', clusterCount: 250 });
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([fullOrg1, fullOrg2]);

      await expect(provisionNextCluster(userId)).rejects.toMatchObject({
        code: 'STORAGE_FULL',
      });
    });

    it('throws STORAGE_FULL when user has no org keys', async () => {
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([]);

      await expect(provisionNextCluster(userId)).rejects.toMatchObject({
        code: 'STORAGE_FULL',
      });
    });
  });

  describe('ensureCapacity', () => {
    // Packing uses USABLE_BYTES = 512MB - 20MB = 492MB
    const STORAGE_LIMIT = 512 * 1024 * 1024;
    const SAFETY_MARGIN = 20 * 1024 * 1024;
    const USABLE = STORAGE_LIMIT - SAFETY_MARGIN; // 492MB

    it('returns active cluster when it has enough room (within USABLE_BYTES)', async () => {
      const activeCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-has-room',
        status: 'active',
        userId,
        storageUsedBytes: 100_000,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      mockGetActiveCluster.mockResolvedValue(activeCluster as unknown as Awaited<ReturnType<typeof getActiveCluster>>);

      const result = await ensureCapacity(userId, 50_000);
      expect(result).toEqual(activeCluster);
    });

    it('returns active cluster at 85% of USABLE — old 80% gate must be gone', async () => {
      // 85% of USABLE = ~418MB — the old code would have spilled to a new cluster at 80% of 512MB (409MB)
      // New code: free = USABLE - used = 492MB - 418MB = 74MB; should still accept uploads up to 74MB
      const used = Math.floor(USABLE * 0.85);
      const activeCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-85pct',
        status: 'active',
        userId,
        storageUsedBytes: used,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      mockGetActiveCluster.mockResolvedValue(activeCluster as unknown as Awaited<ReturnType<typeof getActiveCluster>>);

      // Request 1MB — should fit since 74MB is free
      const result = await ensureCapacity(userId, 1024 * 1024);
      expect(result).toEqual(activeCluster);
      expect(mockOrgKeyModel.find).not.toHaveBeenCalled(); // no provisioning
    });

    it('provisions new cluster when no active cluster exists', async () => {
      mockGetActiveCluster.mockResolvedValue(null);

      const orgKey = makeOrgKey();
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([orgKey]);

      const atlasClient = makeAtlasClientMock();
      mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

      const newCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'new-cluster',
        status: 'active',
        userId,
        storageUsedBytes: 0,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(null);
      (mockStorageClusterModel.updateMany as jest.Mock).mockResolvedValue({});
      (mockStorageClusterModel.create as jest.Mock).mockResolvedValue(newCluster);
      (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      const result = await ensureCapacity(userId, 50_000);
      expect(result).toBeDefined();
      expect(atlasClient.createProject).toHaveBeenCalled();
    });

    it('provisions new cluster when USABLE_BYTES would be exceeded', async () => {
      // 98% of USABLE used — only 2% free (≈9.8MB), need 100MB → spill
      const used = Math.floor(USABLE * 0.98);
      const activeCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-nearly-full',
        status: 'active',
        userId,
        storageUsedBytes: used,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      mockGetActiveCluster.mockResolvedValue(activeCluster as unknown as Awaited<ReturnType<typeof getActiveCluster>>);

      const orgKey = makeOrgKey();
      (mockOrgKeyModel.find as jest.Mock).mockResolvedValue([orgKey]);

      const atlasClient = makeAtlasClientMock();
      mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

      const newCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'new-cluster-2',
        status: 'active',
        userId,
        storageUsedBytes: 0,
        storageCapacityBytes: STORAGE_LIMIT,
      };
      (mockStorageClusterModel.findOne as jest.Mock).mockResolvedValue(activeCluster);
      (mockStorageClusterModel.updateMany as jest.Mock).mockResolvedValue({});
      (mockStorageClusterModel.create as jest.Mock).mockResolvedValue(newCluster);
      (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      // neededBytes = 100MB, but only 2% of 492MB = ~9.8MB free
      const neededBytes = 100 * 1024 * 1024;
      const result = await ensureCapacity(userId, neededBytes);
      expect(result).toBeDefined();
      expect(atlasClient.createProject).toHaveBeenCalled();
    });

    it('returns active cluster without provisioning when there is enough space', async () => {
      const activeCluster = {
        _id: new Types.ObjectId(),
        clusterId: 'cluster-plenty',
        status: 'active',
        userId,
        storageUsedBytes: 1024, // almost empty
        storageCapacityBytes: STORAGE_LIMIT,
      };
      mockGetActiveCluster.mockResolvedValue(activeCluster as unknown as Awaited<ReturnType<typeof getActiveCluster>>);

      const result = await ensureCapacity(userId, 1024 * 1024); // needs 1MB, plenty of room
      expect(result).toEqual(activeCluster);
      expect(mockOrgKeyModel.find).not.toHaveBeenCalled(); // no provisioning needed
    });
  });
});

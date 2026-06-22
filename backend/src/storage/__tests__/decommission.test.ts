import { Types } from 'mongoose';

jest.mock('../../models', () => ({
  OrgKeyModel: {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  StorageClusterModel: {
    find: jest.fn(),
    countDocuments: jest.fn(),
    deleteOne: jest.fn(),
  },
  BlobModel: {
    exists: jest.fn(),
  },
}));

jest.mock('../../atlas/client', () => ({
  makeAtlasClient: jest.fn(),
}));

jest.mock('../clusterManager', () => ({
  closeCluster: jest.fn(),
  USABLE_BYTES: (512 - 20) * 1024 * 1024,
}));

import { OrgKeyModel, StorageClusterModel, BlobModel } from '../../models';
import { makeAtlasClient } from '../../atlas/client';
import { closeCluster } from '../clusterManager';
import { decommissionEmptyClusters } from '../decommission';

const mockOrgKeyModel = OrgKeyModel as jest.Mocked<typeof OrgKeyModel>;
const mockStorageClusterModel = StorageClusterModel as jest.Mocked<typeof StorageClusterModel>;
const mockBlobModel = BlobModel as jest.Mocked<typeof BlobModel>;
const mockMakeAtlasClient = makeAtlasClient as jest.MockedFunction<typeof makeAtlasClient>;
const mockCloseCluster = closeCluster as jest.MockedFunction<typeof closeCluster>;

function makeOrgKeyDoc(id: Types.ObjectId) {
  return {
    _id: id,
    publicKey: 'pub-key',
    privateKey: 'priv-key',
    orgId: 'org-1',
    clusterCount: 2,
  };
}

const userId = new Types.ObjectId().toString();
const orgKeyId = new Types.ObjectId();

function makeAtlasClientMock() {
  return {
    deleteCluster: jest.fn(async () => ({})),
    deleteProject: jest.fn(async () => ({})),
    // include required interface stubs
    apiGet: jest.fn(),
    apiPost: jest.fn(),
    apiPatch: jest.fn(),
    discoverOrgId: jest.fn(),
    createProject: jest.fn(),
    createCluster: jest.fn(),
    waitForCluster: jest.fn(),
    createDatabaseUser: jest.fn(),
    addIpAllowlist: jest.fn(),
    buildConnectionUri: jest.fn(),
    parseCredentialsFromUri: jest.fn(),
    addOrgApiKeyAccessList: jest.fn(),
    withOrgApiAccessListRetry: jest.fn(),
    extractRequiredAccessListIp: jest.fn(),
  };
}

function makeCluster(overrides: Partial<{
  _id: Types.ObjectId;
  clusterId: string;
  projectId: string;
  status: string;
  orgKeyId: Types.ObjectId;
}> = {}) {
  return {
    _id: overrides._id ?? new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    orgKeyId: overrides.orgKeyId ?? orgKeyId,
    clusterId: overrides.clusterId ?? 'shard-cluster-1',
    projectId: overrides.projectId ?? 'proj-1',
    clusterName: overrides.clusterId ?? 'shard-cluster-1',
    connectionUri: 'mongodb+srv://u:p@host/db',
    status: overrides.status ?? 'full',
    storageUsedBytes: 0,
    storageCapacityBytes: 512 * 1024 * 1024,
  };
}

describe('decommissionEmptyClusters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('decommissions an empty non-active cluster that is not the last one', async () => {
    const activeCluster = makeCluster({ clusterId: 'shard-active', status: 'active' });
    const emptyFullCluster = makeCluster({ clusterId: 'shard-full-empty', projectId: 'proj-full', status: 'full' });

    // find() returns both clusters
    (mockStorageClusterModel.find as jest.Mock).mockResolvedValue([activeCluster, emptyFullCluster]);

    // BlobModel.exists: no blobs for the empty cluster
    (mockBlobModel.exists as jest.Mock).mockImplementation(async (query: { clusterId: unknown }) => {
      if (String(query.clusterId) === String(emptyFullCluster._id)) return null;
      return { _id: new Types.ObjectId() };
    });

    // countDocuments: 1 remaining cluster after removing emptyFullCluster
    (mockStorageClusterModel.countDocuments as jest.Mock).mockResolvedValue(1);

    (mockOrgKeyModel.findById as jest.Mock).mockResolvedValue(makeOrgKeyDoc(emptyFullCluster.orgKeyId));

    const atlasClient = makeAtlasClientMock();
    mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

    (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});
    (mockStorageClusterModel.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });
    mockCloseCluster.mockResolvedValue(undefined);

    await decommissionEmptyClusters(userId);

    expect(atlasClient.deleteCluster).toHaveBeenCalledWith(
      emptyFullCluster.projectId,
      emptyFullCluster.clusterName,
    );
    expect(atlasClient.deleteProject).toHaveBeenCalledWith(emptyFullCluster.projectId);
    expect(mockOrgKeyModel.findByIdAndUpdate).toHaveBeenCalledWith(
      emptyFullCluster.orgKeyId,
      { $inc: { clusterCount: -1 } },
    );
    expect(mockStorageClusterModel.deleteOne).toHaveBeenCalledWith({ _id: emptyFullCluster._id });
    expect(mockCloseCluster).toHaveBeenCalledWith(emptyFullCluster.clusterId);
  });

  it('does NOT decommission the active cluster even if empty', async () => {
    const activeCluster = makeCluster({ clusterId: 'shard-active', status: 'active' });
    const anotherCluster = makeCluster({ clusterId: 'shard-full', status: 'full' });

    (mockStorageClusterModel.find as jest.Mock).mockResolvedValue([activeCluster, anotherCluster]);

    // No blobs anywhere
    (mockBlobModel.exists as jest.Mock).mockResolvedValue(null);

    // countDocuments: 1 remaining cluster after removing anotherCluster
    (mockStorageClusterModel.countDocuments as jest.Mock).mockResolvedValue(1);

    (mockOrgKeyModel.findById as jest.Mock).mockResolvedValue(makeOrgKeyDoc(anotherCluster.orgKeyId));

    const atlasClient = makeAtlasClientMock();
    mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

    (mockOrgKeyModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});
    (mockStorageClusterModel.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });
    mockCloseCluster.mockResolvedValue(undefined);

    await decommissionEmptyClusters(userId);

    // Only the non-active full cluster should be decommissioned
    expect(atlasClient.deleteCluster).toHaveBeenCalledTimes(1);
    expect(atlasClient.deleteCluster).toHaveBeenCalledWith(
      anotherCluster.projectId,
      anotherCluster.clusterName,
    );
    // Active cluster must not be deleted
    expect(atlasClient.deleteCluster).not.toHaveBeenCalledWith(
      activeCluster.projectId,
      activeCluster.clusterName,
    );
  });

  it('does NOT decommission a cluster that still has Blobs', async () => {
    const activeCluster = makeCluster({ clusterId: 'shard-active', status: 'active' });
    const clusterWithBlobs = makeCluster({ clusterId: 'shard-with-blobs', projectId: 'proj-blobs', status: 'full' });

    (mockStorageClusterModel.find as jest.Mock).mockResolvedValue([activeCluster, clusterWithBlobs]);

    // BlobModel.exists returns a match for the cluster-with-blobs
    (mockBlobModel.exists as jest.Mock).mockResolvedValue({ _id: new Types.ObjectId() });

    const atlasClient = makeAtlasClientMock();
    mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

    await decommissionEmptyClusters(userId);

    expect(atlasClient.deleteCluster).not.toHaveBeenCalled();
    expect(atlasClient.deleteProject).not.toHaveBeenCalled();
  });

  it('does NOT decommission the last remaining cluster', async () => {
    // Only one cluster exists for this user
    const onlyCluster = makeCluster({ clusterId: 'shard-only', status: 'full' });

    (mockStorageClusterModel.find as jest.Mock).mockResolvedValue([onlyCluster]);
    (mockBlobModel.exists as jest.Mock).mockResolvedValue(null);

    const atlasClient = makeAtlasClientMock();
    mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

    await decommissionEmptyClusters(userId);

    // Early exit — only 1 cluster total, never decommissioned
    expect(atlasClient.deleteCluster).not.toHaveBeenCalled();
    expect(atlasClient.deleteProject).not.toHaveBeenCalled();
  });

  it('does nothing when user has no clusters', async () => {
    (mockStorageClusterModel.find as jest.Mock).mockResolvedValue([]);

    const atlasClient = makeAtlasClientMock();
    mockMakeAtlasClient.mockReturnValue(atlasClient as ReturnType<typeof makeAtlasClient>);

    await decommissionEmptyClusters(userId);

    expect(atlasClient.deleteCluster).not.toHaveBeenCalled();
  });
});

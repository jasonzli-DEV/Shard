jest.mock('../../models', () => ({
  StorageClusterModel: {
    find: jest.fn(),
  },
}));

jest.mock('../clusterManager', () => ({
  runStorageCheck: jest.fn(),
  keepalive: jest.fn(),
}));

jest.mock('../provisioner', () => ({
  provisionNextCluster: jest.fn(),
}));

jest.mock('../decommission', () => ({
  decommissionEmptyClusters: jest.fn(),
}));

import { StorageClusterModel } from '../../models';
import { runStorageCheck, keepalive } from '../clusterManager';
import { provisionNextCluster } from '../provisioner';
import { decommissionEmptyClusters } from '../decommission';
import { startStorageLoops, stopStorageLoops } from '../scheduler';

const mockStorageClusterModel = StorageClusterModel as jest.Mocked<typeof StorageClusterModel>;
const mockRunStorageCheck = runStorageCheck as jest.MockedFunction<typeof runStorageCheck>;
const mockKeepalive = keepalive as jest.MockedFunction<typeof keepalive>;
const mockProvisionNextCluster = provisionNextCluster as jest.MockedFunction<typeof provisionNextCluster>;
const mockDecommissionEmptyClusters = decommissionEmptyClusters as jest.MockedFunction<typeof decommissionEmptyClusters>;

describe('scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopStorageLoops();
    jest.useRealTimers();
  });

  describe('startStorageLoops', () => {
    function mockFind(results: unknown[]) {
      // lean() is called on the result of find(), and then awaited directly
      const chain = {
        lean: jest.fn().mockResolvedValue(results),
      };
      (mockStorageClusterModel.find as jest.Mock).mockReturnValue(chain);
    }

    it('runs keepalive every 60 seconds', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockFind([]);

      startStorageLoops();

      // Advance by 60s
      await jest.advanceTimersByTimeAsync(60_000);

      expect(mockKeepalive).toHaveBeenCalledTimes(1);

      // Advance by another 60s
      await jest.advanceTimersByTimeAsync(60_000);

      expect(mockKeepalive).toHaveBeenCalledTimes(2);
    });

    it('runs storage check every 10 minutes', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockRunStorageCheck.mockResolvedValue({ checked: false });
      mockFind([]);

      startStorageLoops();

      // Advance 10 min
      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(mockStorageClusterModel.find).toHaveBeenCalledTimes(1);
    });

    it('provisions a new cluster when storage check hits threshold', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockRunStorageCheck.mockResolvedValue({
        checked: true,
        atThreshold: true,
        clusterId: 'some-cluster',
        usedBytes: 420 * 1024 * 1024,
      });
      mockProvisionNextCluster.mockResolvedValue({} as ReturnType<typeof provisionNextCluster> extends Promise<infer T> ? T : never);

      const userId = '507f1f77bcf86cd799439011';
      mockFind([{ userId, clusterId: 'some-cluster', status: 'active' }]);

      startStorageLoops();

      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(mockRunStorageCheck).toHaveBeenCalledWith(userId);
      expect(mockProvisionNextCluster).toHaveBeenCalledWith(userId);
    });

    it('does not provision when storage check is below threshold', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockRunStorageCheck.mockResolvedValue({
        checked: true,
        atThreshold: false,
        clusterId: 'some-cluster',
        usedBytes: 100 * 1024 * 1024,
      });

      const userId = '507f1f77bcf86cd799439011';
      mockFind([{ userId, clusterId: 'some-cluster', status: 'active' }]);

      startStorageLoops();

      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(mockRunStorageCheck).toHaveBeenCalled();
      expect(mockProvisionNextCluster).not.toHaveBeenCalled();
    });

    it('does not throw if keepalive fails', async () => {
      mockKeepalive.mockRejectedValue(new Error('connection lost'));
      mockFind([]);

      startStorageLoops();

      await jest.advanceTimersByTimeAsync(60_000);

      // Should not throw or crash
      expect(mockKeepalive).toHaveBeenCalled();
    });

    it('runs empty-cluster sweep every 30 minutes', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockDecommissionEmptyClusters.mockResolvedValue(undefined);
      mockRunStorageCheck.mockResolvedValue({ checked: false });

      const testUserId = '507f1f77bcf86cd799439099';
      const chain = {
        lean: jest.fn().mockResolvedValue([
          { userId: { toString: () => testUserId }, clusterId: 'c-sweep', status: 'full' },
        ]),
      };
      (mockStorageClusterModel.find as jest.Mock).mockReturnValue(chain);

      startStorageLoops();

      // Advance 30 min — should trigger EMPTY_SWEEP
      await jest.advanceTimersByTimeAsync(30 * 60_000);

      expect(mockDecommissionEmptyClusters).toHaveBeenCalledWith(testUserId);
    });

    it('calls decommissionEmptyClusters for each user with any cluster', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      mockDecommissionEmptyClusters.mockResolvedValue(undefined);
      mockRunStorageCheck.mockResolvedValue({ checked: false });

      const userId1 = '507f1f77bcf86cd799439011';
      const userId2 = '507f1f77bcf86cd799439012';

      // find() returns clusters for all users (used by both storageCheck and empty sweep)
      const chain = {
        lean: jest.fn().mockResolvedValue([
          { userId: { toString: () => userId1 }, clusterId: 'c1', status: 'full' },
          { userId: { toString: () => userId2 }, clusterId: 'c2', status: 'active' },
          { userId: { toString: () => userId1 }, clusterId: 'c3', status: 'active' },
        ]),
      };
      (mockStorageClusterModel.find as jest.Mock).mockReturnValue(chain);

      startStorageLoops();

      await jest.advanceTimersByTimeAsync(30 * 60_000);

      expect(mockDecommissionEmptyClusters).toHaveBeenCalledWith(userId1);
      expect(mockDecommissionEmptyClusters).toHaveBeenCalledWith(userId2);
      // Each called exactly once even though userId1 appears twice
      expect(mockDecommissionEmptyClusters).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopStorageLoops', () => {
    it('clears intervals so no more callbacks fire', async () => {
      mockKeepalive.mockResolvedValue(undefined);
      const chain = { lean: jest.fn().mockResolvedValue([]) };
      (mockStorageClusterModel.find as jest.Mock).mockReturnValue(chain);

      startStorageLoops();
      stopStorageLoops();

      await jest.advanceTimersByTimeAsync(60_000);

      expect(mockKeepalive).not.toHaveBeenCalled();
    });
  });
});

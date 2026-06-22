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

import { StorageClusterModel } from '../../models';
import { runStorageCheck, keepalive } from '../clusterManager';
import { provisionNextCluster } from '../provisioner';
import { startStorageLoops, stopStorageLoops } from '../scheduler';

const mockStorageClusterModel = StorageClusterModel as jest.Mocked<typeof StorageClusterModel>;
const mockRunStorageCheck = runStorageCheck as jest.MockedFunction<typeof runStorageCheck>;
const mockKeepalive = keepalive as jest.MockedFunction<typeof keepalive>;
const mockProvisionNextCluster = provisionNextCluster as jest.MockedFunction<typeof provisionNextCluster>;

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

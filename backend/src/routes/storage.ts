/**
 * Storage routes — Phase 5.4
 *
 * Session-auth endpoints for storage stats and Atlas org key management.
 * Mounts at /api (alongside files router).
 *
 *   GET  /api/storage          — per-org / per-cluster usage, totals, active provisioning state
 *   GET  /api/orgs             — list user's org keys
 *   POST /api/orgs             — add org key (label, publicKey, privateKey, region?)
 *                                validates by calling atlas.discoverOrgId(); stores orgId
 *   DELETE /api/orgs/:id       — remove org key
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { OrgKeyModel } from '../models/OrgKey';
import { StorageClusterModel } from '../models/StorageCluster';
import { makeAtlasClient } from '../atlas/client';
import { getStarter } from '../lib/db';
import { logger } from '../utils/logger';

const router = Router();

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setStorageConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getModel<T>(Model: mongoose.Model<T>): mongoose.Model<T> {
  const conn = getConn();
  try {
    return conn.model(Model.modelName) as mongoose.Model<T>;
  } catch {
    return conn.model(Model.modelName, Model.schema) as mongoose.Model<T>;
  }
}

// All routes require auth
router.use(requireAuth);

// ── GET /api/storage ──────────────────────────────────────────────────────────
router.get('/storage', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const OrgKey = getModel(OrgKeyModel);
    const Cluster = getModel(StorageClusterModel);

    const orgKeys = await OrgKey.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    const clusters = await Cluster.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();

    const orgStats = orgKeys.map((org) => {
      const orgClusters = clusters.filter(
        (c) => c.orgKeyId.toString() === (org as any)._id.toString(),
      );

      const activeCluster = orgClusters.find((c) => c.status === 'active') ?? null;
      const provisioningCluster = orgClusters.find((c) => c.status === 'provisioning') ?? null;

      return {
        orgId: (org as any)._id.toString(),
        label: org.label,
        region: org.region ?? null,
        clusterCount: org.clusterCount,
        activeProvisioning: provisioningCluster !== null,
        clusters: orgClusters.map((c) => ({
          id: (c as any)._id.toString(),
          clusterId: c.clusterId,
          status: c.status,
          storageUsedBytes: c.storageUsedBytes,
          storageCapacityBytes: c.storageCapacityBytes,
          usedPercent:
            c.storageCapacityBytes > 0
              ? Math.round((c.storageUsedBytes / c.storageCapacityBytes) * 100)
              : 0,
          lastCheckedAt: c.lastCheckedAt ?? null,
        })),
        activeCluster: activeCluster
          ? {
              id: (activeCluster as any)._id.toString(),
              clusterId: activeCluster.clusterId,
              storageUsedBytes: activeCluster.storageUsedBytes,
              storageCapacityBytes: activeCluster.storageCapacityBytes,
              usedPercent:
                activeCluster.storageCapacityBytes > 0
                  ? Math.round(
                      (activeCluster.storageUsedBytes / activeCluster.storageCapacityBytes) * 100,
                    )
                  : 0,
            }
          : null,
        totalUsedBytes: orgClusters.reduce((s, c) => s + c.storageUsedBytes, 0),
        totalCapacityBytes: orgClusters.reduce((s, c) => s + c.storageCapacityBytes, 0),
      };
    });

    const totalUsedBytes = clusters.reduce((s, c) => s + c.storageUsedBytes, 0);
    const totalCapacityBytes = clusters.reduce((s, c) => s + c.storageCapacityBytes, 0);

    // ── Starter cluster usage ─────────────────────────────────────────────────
    const STARTER_CAPACITY_BYTES = parseInt(
      process.env.STARTER_CAPACITY_BYTES ?? String(512 * 1024 * 1024),
      10
    );
    const WARN_THRESHOLD = 0.8;

    let starterUsedBytes = 0;
    let starterNearCapacity = false;

    try {
      const conn = getConn();
      const dbStats = await conn.db?.command({ dbStats: 1, scale: 1 });
      if (dbStats) {
        starterUsedBytes = dbStats.storageSize ?? dbStats.dataSize ?? 0;
        starterNearCapacity =
          STARTER_CAPACITY_BYTES > 0 &&
          starterUsedBytes / STARTER_CAPACITY_BYTES >= WARN_THRESHOLD;
      }
    } catch {
      // Non-fatal — usage is best-effort
    }

    res.json({
      orgs: orgStats,
      totalUsedBytes,
      totalCapacityBytes,
      usedPercent:
        totalCapacityBytes > 0 ? Math.round((totalUsedBytes / totalCapacityBytes) * 100) : 0,
      starter: {
        usedBytes: starterUsedBytes,
        capacityBytes: STARTER_CAPACITY_BYTES,
        usedPercent:
          STARTER_CAPACITY_BYTES > 0
            ? Math.round((starterUsedBytes / STARTER_CAPACITY_BYTES) * 100)
            : 0,
        nearCapacity: starterNearCapacity,
      },
    });
  } catch (err: any) {
    logger.error('GET /api/storage error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/orgs ─────────────────────────────────────────────────────────────
router.get('/orgs', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const OrgKey = getModel(OrgKeyModel);
    const orgKeys = await OrgKey.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    // Never return privateKey in listings
    res.json(
      orgKeys.map((org) => ({
        id: (org as any)._id.toString(),
        label: org.label,
        publicKey: org.publicKey,
        orgId: org.orgId,
        clusterCount: org.clusterCount,
        region: org.region ?? null,
        createdAt: (org as any).createdAt,
      })),
    );
  } catch (err: any) {
    logger.error('GET /api/orgs error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/orgs ────────────────────────────────────────────────────────────
router.post('/orgs', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const body = req.body as {
    label?: string;
    publicKey?: string;
    privateKey?: string;
    region?: string;
  };

  const { label, publicKey, privateKey, region } = body;

  if (!label || typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'label is required' });
    return;
  }
  if (!publicKey || typeof publicKey !== 'string' || !publicKey.trim()) {
    res.status(400).json({ error: 'publicKey is required' });
    return;
  }
  if (!privateKey || typeof privateKey !== 'string' || !privateKey.trim()) {
    res.status(400).json({ error: 'privateKey is required' });
    return;
  }

  try {
    // Validate keys by calling Atlas to discover the org ID
    const client = makeAtlasClient({ publicKey: publicKey.trim(), privateKey: privateKey.trim() });
    const orgId = await client.discoverOrgId();

    const OrgKey = getModel(OrgKeyModel);
    const doc = await OrgKey.create({
      userId: new mongoose.Types.ObjectId(userId),
      label: label.trim(),
      publicKey: publicKey.trim(),
      privateKey: privateKey.trim(),
      orgId,
      clusterCount: 0,
      ...(region ? { region: region.trim() } : {}),
    });

    res.status(201).json({
      id: doc._id.toString(),
      label: doc.label,
      publicKey: doc.publicKey,
      orgId: doc.orgId,
      clusterCount: doc.clusterCount,
      region: doc.region ?? null,
      createdAt: (doc as any).createdAt,
    });
  } catch (err: any) {
    if (err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('Unauthorized') || err.message?.includes('Invalid') || err.message?.includes('credentials')) {
      res.status(422).json({ error: 'Atlas API key validation failed: ' + err.message });
      return;
    }
    logger.error('POST /api/orgs error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/orgs/:id ──────────────────────────────────────────────────────
router.delete('/orgs/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid org key id' });
    return;
  }

  try {
    const OrgKey = getModel(OrgKeyModel);
    const result = await OrgKey.deleteOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Org key not found' });
      return;
    }

    res.json({ message: 'Org key deleted' });
  } catch (err: any) {
    logger.error('DELETE /api/orgs/:id error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

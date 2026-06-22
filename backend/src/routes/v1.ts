/**
 * REST API v1 — Phase 5.3
 *
 * API-key authenticated REST API, mounted at /api/v1.
 * Reuses services/files.ts and storage/storageService.ts — no duplicated logic.
 *
 * Endpoints:
 *   GET  /api/v1/me                   — current user info
 *   GET  /api/v1/storage              — storage stats (delegates to storageRoutes logic)
 *   GET  /api/v1/files                — list files (parentId or path query)
 *   GET  /api/v1/files/:id            — get single file metadata
 *   GET  /api/v1/files/:id/download   — download file bytes
 *   POST /api/v1/files                — upload file (multipart)
 *   POST /api/v1/folders              — create folder
 *   PATCH /api/v1/files/:id           — rename / move / star
 *   DELETE /api/v1/files/:id          — soft delete
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { UserModel } from '../models/User';
import { FileModel } from '../models/File';
import { OrgKeyModel } from '../models/OrgKey';
import { StorageClusterModel } from '../models/StorageCluster';
import { getStarter } from '../lib/db';
import * as fileService from '../services/files';
import * as storageService from '../storage/storageService';
import { logger } from '../utils/logger';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setV1Connection(conn: mongoose.Connection): void {
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

// All v1 routes require auth (session OR API key)
router.use(requireAuth);

// ── GET /api/v1/me ─────────────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const User = getModel(UserModel);
    const user = await User.findById(userId).lean();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: (user as any)._id.toString(),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      encryptionEnabled: user.encryptionEnabled,
      createdAt: (user as any).createdAt,
    });
  } catch (err: any) {
    logger.error('GET /api/v1/me error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/storage ────────────────────────────────────────────────────
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
      return {
        orgId: (org as any)._id.toString(),
        label: org.label,
        region: org.region ?? null,
        clusterCount: org.clusterCount,
        clusters: orgClusters.map((c) => ({
          id: (c as any)._id.toString(),
          clusterId: c.clusterId,
          status: c.status,
          storageUsedBytes: c.storageUsedBytes,
          storageCapacityBytes: c.storageCapacityBytes,
          usedPercent: c.storageCapacityBytes > 0
            ? Math.round((c.storageUsedBytes / c.storageCapacityBytes) * 100)
            : 0,
          lastCheckedAt: c.lastCheckedAt ?? null,
        })),
        totalUsedBytes: orgClusters.reduce((s, c) => s + c.storageUsedBytes, 0),
        totalCapacityBytes: orgClusters.reduce((s, c) => s + c.storageCapacityBytes, 0),
      };
    });

    const totalUsedBytes = clusters.reduce((s, c) => s + c.storageUsedBytes, 0);
    const totalCapacityBytes = clusters.reduce((s, c) => s + c.storageCapacityBytes, 0);

    res.json({
      orgs: orgStats,
      totalUsedBytes,
      totalCapacityBytes,
      usedPercent:
        totalCapacityBytes > 0 ? Math.round((totalUsedBytes / totalCapacityBytes) * 100) : 0,
    });
  } catch (err: any) {
    logger.error('GET /api/v1/storage error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/files ──────────────────────────────────────────────────────
router.get('/files', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { parentId, path } = req.query as { parentId?: string; path?: string };

  try {
    if (path) {
      // Lookup by path
      const file = await FileModel.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        path,
        deletedAt: null,
      });
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.json([file]);
      return;
    }

    const files = await fileService.list(userId, parentId ?? null);
    res.json(files);
  } catch (err: any) {
    if (err.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: err.message });
    } else {
      logger.error('GET /api/v1/files error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── GET /api/v1/files/:id ─────────────────────────────────────────────────
router.get('/files/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const file = await FileModel.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
      deletedAt: null,
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.json(file);
  } catch (err: any) {
    logger.error('GET /api/v1/files/:id error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/files/:id/download ────────────────────────────────────────
router.get('/files/:id/download', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const file = await FileModel.findById(id);

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Reject soft-deleted (trashed) files
    if (file.deletedAt != null) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    if (file.userId.toString() !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (file.type === 'folder') {
      res.status(400).json({ error: 'Cannot download a folder' });
      return;
    }

    let encryptionKey: string | undefined;
    if (file.encrypted) {
      const User = getModel(UserModel);
      const user = await User.findById(userId);
      encryptionKey = user?.encryptionKey ?? undefined;
    }

    const buffer = await storageService.readFile(id, encryptionKey);

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    logger.error('GET /api/v1/files/:id/download error', { error: err.message });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/v1/files ─────────────────────────────────────────────────────
router.post('/files', upload.single('file'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  if (!req.file) {
    res.status(400).json({ error: 'file is required (multipart/form-data)' });
    return;
  }

  const { parentId = null } = req.body as { parentId?: string | null };
  const name = req.file.originalname;
  const mimeType = req.file.mimetype;
  const buffer = req.file.buffer;

  try {
    const User = getModel(UserModel);
    const user = await User.findById(userId);
    const encrypt = user?.encryptionEnabled ?? false;
    const encryptionKey = encrypt ? user?.encryptionKey ?? undefined : undefined;

    const file = await storageService.storeFile({
      userId,
      parentId: parentId ?? null,
      name,
      buffer,
      mimeType,
      encrypt,
      encryptionKey,
    });

    res.status(201).json(file);
  } catch (err: any) {
    logger.error('POST /api/v1/files error', { error: err.message });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/v1/folders ───────────────────────────────────────────────────
router.post('/folders', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { name, parentId = null } = req.body as { name?: string; parentId?: string | null };

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const folder = await fileService.createFolder(userId, parentId ?? null, name);
    res.status(201).json(folder);
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else if (err.code === 'PATH_CONFLICT') {
      res.status(409).json({ error: err.message });
    } else if (err.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: err.message });
    } else {
      logger.error('POST /api/v1/folders error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── PATCH /api/v1/files/:id ────────────────────────────────────────────────
router.patch('/files/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const body = req.body as {
    name?: string;
    parentId?: string | null;
    starred?: boolean;
  };

  try {
    let file;

    if (body.name !== undefined && body.parentId !== undefined) {
      file = await fileService.rename(userId, id, body.name);
      file = await fileService.move(userId, id, body.parentId ?? null);
    } else if (body.name !== undefined) {
      file = await fileService.rename(userId, id, body.name);
    } else if (body.parentId !== undefined) {
      file = await fileService.move(userId, id, body.parentId ?? null);
    } else if (body.starred !== undefined) {
      file = await fileService.star(userId, id, body.starred);
    } else {
      res.status(400).json({ error: 'Provide name, parentId, or starred to update' });
      return;
    }

    res.json(file);
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else if (err.code === 'PATH_CONFLICT') {
      res.status(409).json({ error: err.message });
    } else if (err.code === 'INVALID_MOVE') {
      res.status(400).json({ error: err.message });
    } else if (err.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: err.message });
    } else {
      logger.error('PATCH /api/v1/files/:id error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── DELETE /api/v1/files/:id (soft delete) ────────────────────────────────
router.delete('/files/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    await fileService.softDelete(userId, id);
    res.json({ message: 'File moved to trash' });
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('DELETE /api/v1/files/:id error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;

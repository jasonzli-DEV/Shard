/**
 * File routes — Phase 5.2
 *
 * Session-auth (and API-key-auth) file CRUD + upload/download endpoints.
 * Mount this router at /api in app.ts — it registers /files, /folders, /trash, /search.
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { UserModel } from '../models/User';
import { FileModel } from '../models/File';
import { getStarter } from '../lib/db';
import * as fileService from '../services/files';
import * as storageService from '../storage/storageService';
import { canAccess } from '../services/shares';
import { logger } from '../utils/logger';
import { handleStarterWriteError } from '../utils/starterErrors';

const router = Router();

// Multer: store uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setFilesConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getUserModel(): mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(UserModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  } catch {
    return conn.model(UserModel.modelName, UserModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof UserModel.schema>>;
  }
}

// ── All routes require auth ───────────────────────────────────────────────────
router.use(requireAuth);

// ── GET /api/search?q= ────────────────────────────────────────────────────────
// NOTE: Register /search before /files/:id to avoid routing ambiguity
router.get('/search', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const q = (req.query.q as string) || '';

  try {
    const results = await fileService.search(userId, q);
    res.json(results);
  } catch (err: any) {
    logger.error('GET /api/search error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/trash ────────────────────────────────────────────────────────────
router.get('/trash', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const files = await fileService.listTrash(userId);
    res.json(files);
  } catch (err: any) {
    logger.error('GET /api/trash error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/folders ─────────────────────────────────────────────────────────
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
    } else if (handleStarterWriteError(err, res)) {
      return;
    } else {
      logger.error('POST /api/folders error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── GET /api/files?parentId= ──────────────────────────────────────────────────
router.get('/files', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const parentId = (req.query.parentId as string) || null;

  try {
    const files = await fileService.list(userId, parentId);
    res.json(files);
  } catch (err: any) {
    if (err.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: err.message });
    } else {
      logger.error('GET /api/files error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── POST /api/files (multipart upload) ────────────────────────────────────────
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
    const User = getUserModel();
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
    if (handleStarterWriteError(err, res)) return;
    logger.error('POST /api/files error', { error: err.message });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── GET /api/files/:id/download ───────────────────────────────────────────────
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

    const hasAccess = await canAccess(userId, id, 'view');
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (file.type === 'folder') {
      res.status(400).json({ error: 'Cannot download a folder' });
      return;
    }

    let encryptionKey: string | undefined;
    if (file.encrypted) {
      // Only the owner has their encryption key
      if (file.userId.toString() === userId) {
        const User = getUserModel();
        const user = await User.findById(userId);
        encryptionKey = user?.encryptionKey ?? undefined;
      }
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
    logger.error('GET /api/files/:id/download error', { error: err.message });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── PATCH /api/files/:id (rename / move / star) ───────────────────────────────
router.patch('/files/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const body = req.body as {
    name?: string;
    parentId?: string | null;
    starred?: boolean;
  };

  // Resolve the file first so we can return 404 before a 403 for missing files
  const targetFile = await FileModel.findById(id);
  if (!targetFile) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // Require edit permission for rename/move/star
  const hasEditAccess = await canAccess(userId, id, 'edit');
  if (!hasEditAccess) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Use the file's actual owner userId for the service layer (supports shared-user ops)
  const fileOwnerId = targetFile.userId.toString();

  try {
    let file;

    if (body.name !== undefined && body.parentId !== undefined) {
      file = await fileService.rename(fileOwnerId, id, body.name);
      file = await fileService.move(fileOwnerId, id, body.parentId ?? null);
    } else if (body.name !== undefined) {
      file = await fileService.rename(fileOwnerId, id, body.name);
    } else if (body.parentId !== undefined) {
      file = await fileService.move(fileOwnerId, id, body.parentId ?? null);
    } else if (body.starred !== undefined) {
      file = await fileService.star(fileOwnerId, id, body.starred);
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
      logger.error('PATCH /api/files/:id error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── DELETE /api/files/:id (soft delete) ───────────────────────────────────────
router.delete('/files/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  // Check existence first so we return 404 before 403 for missing files
  const targetFile = await FileModel.findById(id);
  if (!targetFile) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // Require edit permission to delete
  const hasEditAccess = await canAccess(userId, id, 'edit');
  if (!hasEditAccess) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const fileOwnerId = targetFile.userId.toString();

  try {
    await fileService.softDelete(fileOwnerId, id);
    res.json({ message: 'File moved to trash' });
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('DELETE /api/files/:id error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── POST /api/files/:id/restore ───────────────────────────────────────────────
router.post('/files/:id/restore', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const file = await fileService.restore(userId, id);
    res.json(file);
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else if (err.code === 'NOT_DELETED') {
      res.status(400).json({ error: err.message });
    } else if (err.code === 'PATH_CONFLICT') {
      res.status(409).json({ error: err.message });
    } else {
      logger.error('POST /api/files/:id/restore error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── DELETE /api/files/:id/purge ────────────────────────────────────────────────
router.delete('/files/:id/purge', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    await fileService.purge(userId, id);
    res.json({ message: 'File permanently deleted' });
  } catch (err: any) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('DELETE /api/files/:id/purge error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;

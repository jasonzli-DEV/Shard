/**
 * Public links routes — Phase 6.2
 *
 * Authenticated endpoints:
 *   POST   /api/files/:id/public-link   — create link (owner only)
 *   GET    /api/public-links            — list current user's links
 *   DELETE /api/public-links/:id        — delete a link (creator only)
 *
 * Public (no auth) endpoints:
 *   GET    /api/public/:slug            — file metadata (410 if expired)
 *   GET    /api/public/:slug/download   — file bytes (410 if expired)
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { getStarter } from '../lib/db';
import * as publicLinksService from '../services/publicLinks';
import * as storageService from '../storage/storageService';
import { logger } from '../utils/logger';

const router = Router();

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setPublicLinksConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

// ── PUBLIC routes (no auth) — register BEFORE the auth middleware block ────────

// GET /api/public/:slug — file metadata
router.get('/public/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params;

  // Avoid matching /api/public/:slug/download
  if (slug === undefined) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const file = await publicLinksService.resolveSlug(slug);
    res.json({
      _id: file._id.toString(),
      name: file.name,
      path: file.path,
      type: file.type,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    });
  } catch (err: any) {
    if (err.code === 'EXPIRED') {
      res.status(410).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('GET /api/public/:slug error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// GET /api/public/:slug/download — stream file
router.get('/public/:slug/download', async (req: Request, res: Response) => {
  const { slug } = req.params;

  try {
    const file = await publicLinksService.resolveSlug(slug);

    // Increment download count asynchronously
    publicLinksService.incrementDownloadCount(slug).catch(() => null);

    const buffer = await storageService.readFile(file._id.toString());

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    if (err.code === 'EXPIRED') {
      res.status(410).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('GET /api/public/:slug/download error', { error: err.message });
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
});

// ── Authenticated routes ───────────────────────────────────────────────────────
const authRouter = Router();
authRouter.use(requireAuth);

// POST /api/files/:id/public-link — create a public link (owner only)
authRouter.post('/files/:id/public-link', async (req: Request, res: Response) => {
  const callerId = (req as any).userId as string;
  const { id: fileId } = req.params;
  const { expiresIn } = req.body as { expiresIn?: number };

  try {
    const result = await publicLinksService.createPublicLink(callerId, fileId, expiresIn);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.code === 'OWNER_ONLY') {
      res.status(403).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('POST /api/files/:id/public-link error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// GET /api/public-links — list current user's links
authRouter.get('/public-links', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const links = await publicLinksService.listUserPublicLinks(userId);
    res.json(links);
  } catch (err: any) {
    logger.error('GET /api/public-links error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/public-links/:id — delete a link (creator only)
authRouter.delete('/public-links/:id', async (req: Request, res: Response) => {
  const callerId = (req as any).userId as string;
  const { id: linkId } = req.params;

  try {
    await publicLinksService.deletePublicLink(callerId, linkId);
    res.json({ message: 'Public link deleted' });
  } catch (err: any) {
    if (err.code === 'OWNER_ONLY') {
      res.status(403).json({ error: err.message });
    } else if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else {
      logger.error('DELETE /api/public-links/:id error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Merge both routers
router.use(authRouter);

export default router;

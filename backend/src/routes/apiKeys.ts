import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';
import { ApiKeyModel } from '../models/ApiKey';
import { requireAuth } from '../middleware/auth';
import { getStarter } from '../lib/db';
import { logger } from '../utils/logger';

const router = Router();

// nanoid with URL-safe alphabet, length 40
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 40);

// Allow tests to inject a connection
let _overrideConn: mongoose.Connection | null = null;

export function setApiKeysConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getApiKeyModel(): mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(ApiKeyModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>>;
  } catch {
    return conn.model(ApiKeyModel.modelName, ApiKeyModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof ApiKeyModel.schema>>;
  }
}

// All routes require authentication
router.use(requireAuth);

// ── GET /api/keys ─────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const ApiKey = getApiKeyModel();
    const keys = await ApiKey.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    res.json(
      keys.map((k) => ({
        id: k._id.toString(),
        label: k.label,
        lastUsed: k.lastUsed ?? null,
        createdAt: (k as any).createdAt,
        // Never return the full key after creation
        keyHint: `shard_...${k.key.slice(-4)}`,
      }))
    );
  } catch (err) {
    logger.error('GET /api/keys error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/keys ────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { label } = req.body as { label?: string };

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    res.status(400).json({ error: 'label is required' });
    return;
  }

  try {
    const ApiKey = getApiKeyModel();
    await ApiKey.createIndexes();
    const key = `shard_${nanoid()}`;

    const doc = await ApiKey.create({
      userId: new mongoose.Types.ObjectId(userId),
      key,
      label: label.trim(),
    });

    res.status(201).json({
      id: doc._id.toString(),
      label: doc.label,
      key, // Only returned once at creation
      createdAt: (doc as any).createdAt,
    });
  } catch (err) {
    logger.error('POST /api/keys error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/keys/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid key id' });
    return;
  }

  try {
    const ApiKey = getApiKeyModel();
    const result = await ApiKey.deleteOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    res.json({ message: 'API key deleted' });
  } catch (err) {
    logger.error('DELETE /api/keys/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

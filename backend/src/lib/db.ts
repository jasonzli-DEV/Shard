import mongoose from 'mongoose';
import { logger } from '../utils/logger';

// Use globalThis cache for serverless warm invocations
const g = globalThis as typeof globalThis & {
  __shardStarterConn?: mongoose.Connection;
};

/**
 * Connect to the starter cluster (operator-managed metadata store).
 * Uses mongoose.createConnection so it is isolated from the default
 * mongoose connection (which is reserved for per-user clusters).
 *
 * The connection is cached on globalThis so serverless warm invocations
 * reuse the same connection without reconnecting per request.
 */
export async function connectStarter(uri: string): Promise<mongoose.Connection> {
  if (g.__shardStarterConn && g.__shardStarterConn.readyState === 1) {
    return g.__shardStarterConn;
  }

  const conn = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });

  await conn.asPromise();

  g.__shardStarterConn = conn;
  logger.info('Connected to starter MongoDB cluster');

  conn.on('error', (err: Error) => {
    logger.error('Starter connection error', { error: err.message });
  });

  conn.on('disconnected', () => {
    logger.warn('Starter connection disconnected');
    // Clear cache so next call reconnects
    g.__shardStarterConn = undefined;
  });

  return conn;
}

/**
 * Returns the established starter connection.
 * Throws if connectStarter() has not been called yet.
 */
export function getStarter(): mongoose.Connection {
  if (!g.__shardStarterConn) {
    throw new Error('Starter connection not initialised — call connectStarter() first');
  }
  return g.__shardStarterConn;
}

/**
 * Close the starter connection (used in tests / graceful shutdown).
 */
export async function closeStarter(): Promise<void> {
  if (g.__shardStarterConn) {
    await g.__shardStarterConn.close();
    g.__shardStarterConn = undefined;
    logger.info('Starter connection closed');
  }
}

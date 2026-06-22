import mongoose from 'mongoose';
import { logger } from '../utils/logger';

let starterConnection: mongoose.Connection | null = null;

/**
 * Connect to the starter cluster (operator-managed metadata store).
 * Uses mongoose.createConnection so it is isolated from the default
 * mongoose connection (which is reserved for per-user clusters).
 */
export async function connectStarter(uri: string): Promise<mongoose.Connection> {
  if (starterConnection) {
    return starterConnection;
  }

  starterConnection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });

  await starterConnection.asPromise();

  logger.info('Connected to starter MongoDB cluster');

  starterConnection.on('error', (err: Error) => {
    logger.error('Starter connection error', { error: err.message });
  });

  starterConnection.on('disconnected', () => {
    logger.warn('Starter connection disconnected');
  });

  return starterConnection;
}

/**
 * Returns the established starter connection.
 * Throws if connectStarter() has not been called yet.
 */
export function getStarter(): mongoose.Connection {
  if (!starterConnection) {
    throw new Error('Starter connection not initialised — call connectStarter() first');
  }
  return starterConnection;
}

/**
 * Close the starter connection (used in tests / graceful shutdown).
 */
export async function closeStarter(): Promise<void> {
  if (starterConnection) {
    await starterConnection.close();
    starterConnection = null;
    logger.info('Starter connection closed');
  }
}

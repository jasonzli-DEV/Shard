/**
 * Starter cluster error detection and graceful 507 handling (Workstream D).
 *
 * Maps Mongo quota/space/connection errors on metadata writes to clean 507
 * responses with an actionable message. The process must NOT crash.
 */

import { Response } from 'express';

/** Known error patterns indicating the starter cluster is full or unreachable */
const QUOTA_PATTERNS = [
  /over your space quota/i,
  /you are over your space quota/i,
  /exceeded storage/i,
  /storage limit/i,
  /insufficient storage/i,
];

const QUOTA_CODES = new Set([8000]);

const CONNECTION_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /connection pool/i,
  /topology was destroyed/i,
  /server selection timed out/i,
  /MongoNetworkError/i,
  /MongoServerSelectionError/i,
];

export interface StarterError {
  isQuota: boolean;
  isConnection: boolean;
  isStarterError: boolean;
}

/**
 * Classify a Mongo error.
 */
export function classifyStarterError(err: unknown): StarterError {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code;

  const isQuota =
    QUOTA_CODES.has(code) || QUOTA_PATTERNS.some((p) => p.test(message));

  const isConnection = CONNECTION_PATTERNS.some((p) => p.test(message));

  return {
    isQuota,
    isConnection,
    isStarterError: isQuota || isConnection,
  };
}

/**
 * Send a 507 response for starter cluster write failures.
 * Returns true if a 507 was sent (caller should return immediately).
 */
export function handleStarterWriteError(err: unknown, res: Response): boolean {
  const { isStarterError } = classifyStarterError(err);

  if (isStarterError) {
    res.status(507).json({
      error: 'Metadata store is full or unreachable — upgrade the starter cluster',
    });
    return true;
  }

  return false;
}

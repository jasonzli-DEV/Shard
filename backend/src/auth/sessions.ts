import mongoose from 'mongoose';
import { SessionModel } from '../models/Session';
import { signJwt } from './jwt';
import { getStarter } from '../lib/db';

// Allow tests to inject a custom connection
let _overrideConn: mongoose.Connection | null = null;

/** For testing: inject a specific connection instead of getStarter() */
export function setSessionConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getSessionModel(): mongoose.Model<mongoose.InferSchemaType<typeof SessionModel.schema>> {
  const conn = getConn();
  try {
    return conn.model(SessionModel.modelName) as mongoose.Model<mongoose.InferSchemaType<typeof SessionModel.schema>>;
  } catch {
    return conn.model(SessionModel.modelName, SessionModel.schema) as mongoose.Model<mongoose.InferSchemaType<typeof SessionModel.schema>>;
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create a session for the given userId.
 * Returns the signed JWT token (also stored in the Session collection).
 */
export async function createSession(userId: string): Promise<string> {
  const token = signJwt(userId);
  const Session = getSessionModel();
  await Session.create({
    userId: new mongoose.Types.ObjectId(userId),
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

/**
 * Look up a session by token.
 * Returns the userId string if the session is valid and not expired.
 * Returns null if the session doesn't exist or is expired.
 */
export async function getSessionUser(token: string): Promise<string | null> {
  const Session = getSessionModel();
  const session = await Session.findOne({ token });
  if (!session) return null;
  if (session.expiresAt < new Date()) return null;
  return session.userId.toString();
}

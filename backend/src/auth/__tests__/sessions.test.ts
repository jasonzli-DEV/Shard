/**
 * Task 2.1 — Session utils tests
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  // Inject connection for session utils
  process.env.TEST_MONGO_URI = mongod.getUri();
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

// We need to inject the connection into the sessions module.
// The sessions module must accept a connection (or use getStarter).
// Pattern: import after setting up the connection override.
import { createSession, getSessionUser } from '../sessions';

describe('createSession / getSessionUser', () => {
  let testUserId: string;

  beforeAll(() => {
    testUserId = new Types.ObjectId().toHexString();
    // Set the starter connection for sessions module
    const { setSessionConnection } = require('../sessions');
    setSessionConnection(conn);
  });

  it('createSession returns a token string', async () => {
    const token = await createSession(testUserId);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
  });

  it('getSessionUser returns userId for a valid session token', async () => {
    const userId2 = new Types.ObjectId().toHexString();
    const token = await createSession(userId2);
    const resolvedUserId = await getSessionUser(token);
    expect(resolvedUserId).toBe(userId2);
  });

  it('getSessionUser returns null for unknown token', async () => {
    const result = await getSessionUser('nonexistent-token');
    expect(result).toBeNull();
  });

  it('getSessionUser returns null for expired session', async () => {
    // Directly insert an expired session
    const SessionSchema = new mongoose.Schema({
      userId: mongoose.Schema.Types.ObjectId,
      token: String,
      expiresAt: Date,
    });
    const ExpiredSession = conn.model('ExpiredSession', SessionSchema);
    const expiredToken = 'expired-token-123';
    await ExpiredSession.create({
      userId: new Types.ObjectId(),
      token: expiredToken,
      expiresAt: new Date(Date.now() - 1000), // already past
    });

    // sessions module uses its own Session model. We need to insert into that collection.
    // Instead, let's test via the real Session model bound to conn.
    const { SessionModel } = require('../../models/Session');
    const BoundSession = conn.model(SessionModel.modelName, SessionModel.schema);
    const userId2 = new Types.ObjectId().toHexString();
    const expToken2 = 'expired-real-token';
    await BoundSession.create({
      userId: new Types.ObjectId(userId2),
      token: expToken2,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await getSessionUser(expToken2);
    expect(result).toBeNull();
  });
});

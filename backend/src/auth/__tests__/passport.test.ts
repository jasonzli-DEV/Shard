/**
 * Task 2.2 — Passport profile → user upsert + first-user-admin rule
 * We test the upsert logic directly without a live OAuth round trip.
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
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

import { upsertUserFromProfile, OAuthProfile } from '../passport';

describe('upsertUserFromProfile', () => {
  beforeAll(() => {
    const { setPassportConnection } = require('../passport');
    setPassportConnection(conn);
  });

  it('creates a new user from a Google profile', async () => {
    const profile: OAuthProfile = {
      provider: 'google',
      id: 'google-001',
      displayName: 'Alice Google',
      email: 'alice@gmail.com',
      avatarUrl: 'https://example.com/avatar.png',
    };
    const user = await upsertUserFromProfile(profile);
    expect(user.provider).toBe('google');
    expect(user.providerId).toBe('google-001');
    expect(user.email).toBe('alice@gmail.com');
    expect(user.displayName).toBe('Alice Google');
  });

  it('first user ever created gets role admin', async () => {
    // alice was created above — she should be admin (first user)
    const profile: OAuthProfile = {
      provider: 'google',
      id: 'google-001',
      displayName: 'Alice Google',
      email: 'alice@gmail.com',
    };
    const user = await upsertUserFromProfile(profile);
    expect(user.role).toBe('admin');
  });

  it('second user gets role user', async () => {
    const profile: OAuthProfile = {
      provider: 'github',
      id: 'gh-002',
      displayName: 'Bob Github',
      email: 'bob@github.com',
    };
    const user = await upsertUserFromProfile(profile);
    expect(user.role).toBe('user');
  });

  it('upserts existing user on second OAuth login (updates displayName)', async () => {
    const profile: OAuthProfile = {
      provider: 'github',
      id: 'gh-002',
      displayName: 'Bob Github Updated',
      email: 'bob@github.com',
    };
    const user = await upsertUserFromProfile(profile);
    expect(user.displayName).toBe('Bob Github Updated');
    expect(user.role).toBe('user'); // still user, not re-assigned admin
  });

  it('creates a user from a GitHub profile', async () => {
    const profile: OAuthProfile = {
      provider: 'github',
      id: 'gh-999',
      displayName: 'Carol GitHub',
      email: 'carol@github.com',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999',
    };
    const user = await upsertUserFromProfile(profile);
    expect(user.provider).toBe('github');
    expect(user.avatarUrl).toBe('https://avatars.githubusercontent.com/u/999');
  });
});

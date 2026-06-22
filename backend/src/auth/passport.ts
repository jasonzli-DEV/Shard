import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import mongoose from 'mongoose';
import { UserModel, type IUser } from '../models/User';
import { getStarter } from '../lib/db';

export interface OAuthProfile {
  provider: 'google' | 'github';
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
}

// Allow tests to inject a specific connection
let _overrideConn: mongoose.Connection | null = null;

export function setPassportConnection(conn: mongoose.Connection): void {
  _overrideConn = conn;
}

function getConn(): mongoose.Connection {
  if (_overrideConn) return _overrideConn;
  return getStarter();
}

function getUserModel(): mongoose.Model<IUser> {
  const conn = getConn();
  try {
    return conn.model<IUser>(UserModel.modelName);
  } catch {
    return conn.model<IUser>(UserModel.modelName, UserModel.schema);
  }
}

/**
 * Upsert a user from an OAuth profile.
 * The very first user created in the system gets role 'admin'.
 */
export async function upsertUserFromProfile(profile: OAuthProfile): Promise<IUser> {
  const User = getUserModel();
  await User.createIndexes();

  // Check if this provider/id combo already exists
  const existing = await User.findOne({ provider: profile.provider, providerId: profile.id });

  if (existing) {
    // Update mutable fields
    existing.displayName = profile.displayName;
    existing.email = profile.email;
    if (profile.avatarUrl !== undefined) {
      existing.avatarUrl = profile.avatarUrl;
    }
    await existing.save();
    return existing;
  }

  // Determine role: admin if no users exist yet
  const userCount = await User.countDocuments();
  const role: 'admin' | 'user' = userCount === 0 ? 'admin' : 'user';

  const user = await User.create({
    provider: profile.provider,
    providerId: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    role,
  });

  return user;
}

/**
 * Configure passport strategies.
 * Call this once during app startup after the DB connection is established.
 */
export function configurePassport(): void {
  const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:4000';

  // Google
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: `${PUBLIC_URL}/api/auth/google/callback`,
          scope: ['profile', 'email'],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email =
              profile.emails?.[0]?.value ?? '';
            const avatarUrl = profile.photos?.[0]?.value;
            const user = await upsertUserFromProfile({
              provider: 'google',
              id: profile.id,
              displayName: profile.displayName ?? email,
              email,
              avatarUrl,
            });
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }

  // GitHub
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (githubClientId && githubClientSecret) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: githubClientId,
          clientSecret: githubClientSecret,
          callbackURL: `${PUBLIC_URL}/api/auth/github/callback`,
          scope: ['user:email'],
        },
        async (_accessToken: string, _refreshToken: string, profile: any, done: (err: Error | null, user?: IUser) => void) => {
          try {
            const email =
              (profile.emails as Array<{ value: string }> | undefined)?.[0]?.value ?? '';
            const avatarUrl = (profile.photos as Array<{ value: string }> | undefined)?.[0]?.value;
            const user = await upsertUserFromProfile({
              provider: 'github',
              id: profile.id,
              displayName: profile.displayName ?? profile.username ?? email,
              email,
              avatarUrl,
            });
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }

  // Serialize/deserialize (only needed for session-based passport, but safe to define)
  passport.serializeUser((user: any, done) => done(null, user._id.toString()));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const User = getUserModel();
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}

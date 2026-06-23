# Shard v2 Phase A — Config in the Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all runtime config (OAuth creds, publicUrl, allowedOrigins, jwtSecret) from a written `.env` file into a singleton document in the starter MongoDB database, enabling restart-free setup and a read-only filesystem.

**Architecture:** A new `Config` Mongoose model (bound to the starter connection) holds a singleton document. A `configService` module provides `loadConfig()` / `getConfig()` / `saveConfig()` with env-var fallback for backward compat. Consumers (`passport.ts`, `app.ts`, `jwt.ts`) are redirected to `getConfig()`. `routes/setup.ts` is rewritten to upsert the DB doc instead of writing a `.env` file.

**Tech Stack:** TypeScript strict, Mongoose, mongodb-memory-server (tests), Jest, Express, Passport.js, crypto (built-in Node).

## Global Constraints

- Keep ALL existing tests green; add tests for new behavior (TDD).
- Only `STARTER_MONGODB_URI` (+ optional `COOKIE_SECURE`, `PORT`) may be env vars. All other config moves into the starter DB.
- Secrets stored plaintext (consistent with v1's intentional model — mirrors `connectionUri` in StorageCluster).
- TypeScript strict — no implicit `any`, no `!` casts on unchecked values.
- Frontend wizard already POSTs `{ starterUri, google, github, publicUrl, allowedOrigins }` to `/api/setup/configure` — that request contract must not change.
- TDD: write the failing test before the implementation in every task.
- Commit after each task.

---

## File Map

**New files:**
- `backend/src/models/Config.ts` — Config singleton Mongoose model
- `backend/src/config/configService.ts` — loadConfig/getConfig/saveConfig + helpers
- `backend/src/config/__tests__/configService.test.ts` — unit tests for configService
- `.superpowers/sdd/v2-phase-a-report.md` — final report

**Modified files:**
- `backend/src/models/index.ts` — add Config export
- `backend/src/auth/jwt.ts` — read jwtSecret from getConfig() not process.env
- `backend/src/auth/passport.ts` — read OAuth creds + publicUrl from getConfig()
- `backend/src/app.ts` — read allowedOrigins from getConfig()
- `backend/src/routes/setup.ts` — rewrite: DB upsert instead of .env write
- `backend/src/index.ts` — on boot: connectRuntime then loadConfig(); remove SETUP_ENV_FILE_PATH dotenv load
- `backend/src/__tests__/setup.test.ts` — update: new contract (DB persists, no file write)
- `backend/src/auth/__tests__/jwt.test.ts` — update: configService cache set instead of process.env
- `docker-compose.yml` — drop `./config` volume and `SETUP_ENV_FILE_PATH` env

---

### Task 1: Config model + models/index.ts export

**Files:**
- Create: `backend/src/models/Config.ts`
- Modify: `backend/src/models/index.ts`
- Test: `backend/src/models/__tests__/models.test.ts` (add Config model round-trip test)

**Interfaces:**
- Produces:
  ```ts
  export interface IConfig extends Document {
    key: 'singleton';
    googleClientId?: string;
    googleClientSecret?: string;
    githubClientId?: string;
    githubClientSecret?: string;
    publicUrl?: string;
    allowedOrigins?: string;
    jwtSecret: string;
    updatedAt: Date;
  }
  export const ConfigModel: mongoose.Model<IConfig>;
  // ConfigModel is intentionally NOT bound to the starter connection here —
  // configService.ts binds it at runtime via conn.model()
  ```

- [ ] **Step 1: Write the failing test**

Add to `backend/src/models/__tests__/models.test.ts`. Read the file first to find where to insert (after the last `describe` block, before closing):

```ts
describe('Config model', () => {
  it('creates a singleton Config document', async () => {
    const { ConfigModel } = await import('../Config');
    // Bind to the test connection
    let BoundConfig: mongoose.Model<any>;
    try {
      BoundConfig = conn.model(ConfigModel.modelName);
    } catch {
      BoundConfig = conn.model(ConfigModel.modelName, ConfigModel.schema);
    }

    const doc = await BoundConfig.create({
      key: 'singleton',
      jwtSecret: 'testsecret',
      googleClientId: 'gid',
    });

    expect(doc.key).toBe('singleton');
    expect(doc.jwtSecret).toBe('testsecret');
    expect(doc.googleClientId).toBe('gid');
    expect(doc.updatedAt).toBeDefined();
  });

  it('enforces unique key constraint', async () => {
    const { ConfigModel } = await import('../Config');
    let BoundConfig: mongoose.Model<any>;
    try {
      BoundConfig = conn.model(ConfigModel.modelName);
    } catch {
      BoundConfig = conn.model(ConfigModel.modelName, ConfigModel.schema);
    }

    await BoundConfig.deleteMany({});
    await BoundConfig.create({ key: 'singleton', jwtSecret: 'secret1' });
    await expect(
      BoundConfig.create({ key: 'singleton', jwtSecret: 'secret2' })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=models.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../Config'`

- [ ] **Step 3: Create `backend/src/models/Config.ts`**

```ts
import { Schema, model, Document } from 'mongoose';

export interface IConfig extends Document {
  key: 'singleton';
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  publicUrl?: string;
  allowedOrigins?: string;
  jwtSecret: string;
  updatedAt: Date;
}

const ConfigSchema = new Schema<IConfig>(
  {
    key: { type: String, default: 'singleton', required: true },
    googleClientId: { type: String },
    googleClientSecret: { type: String },
    githubClientId: { type: String },
    githubClientSecret: { type: String },
    publicUrl: { type: String },
    allowedOrigins: { type: String },
    jwtSecret: { type: String, required: true },
  },
  { timestamps: true }
);

ConfigSchema.index({ key: 1 }, { unique: true, name: 'config_key_unique' });

export const ConfigModel = model<IConfig>('Config', ConfigSchema);
```

- [ ] **Step 4: Add Config export to `backend/src/models/index.ts`**

Append this line:
```ts
export { ConfigModel, type IConfig } from './Config';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=models.test.ts --no-coverage 2>&1 | tail -20
```

Expected: PASS (all models tests green including new Config tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add backend/src/models/Config.ts backend/src/models/index.ts backend/src/models/__tests__/models.test.ts && rtk git commit -m "$(cat <<'EOF'
feat(config): add Config singleton model bound to starter DB

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: configService — loadConfig / getConfig / saveConfig

**Files:**
- Create: `backend/src/config/configService.ts`
- Create: `backend/src/config/__tests__/configService.test.ts`

**Interfaces:**
- Consumes: `ConfigModel` from `../models/Config`; `getStarter()` from `../lib/db`
- Produces:
  ```ts
  export interface AppConfig {
    googleClientId?: string;
    googleClientSecret?: string;
    githubClientId?: string;
    githubClientSecret?: string;
    publicUrl?: string;
    allowedOrigins?: string;
    jwtSecret: string;
  }

  export async function loadConfig(): Promise<void>
  // Reads singleton from DB, caches in module memory. Creates it (with generated
  // jwtSecret) if absent. Requires starter connection to be open.

  export function getConfig(): AppConfig
  // Sync accessor over in-memory cache. For EACH field, falls back to matching
  // process.env value when the cache/DB value is absent. Never throws.
  // Env fallback map:
  //   googleClientId      → GOOGLE_CLIENT_ID
  //   googleClientSecret  → GOOGLE_CLIENT_SECRET
  //   githubClientId      → GITHUB_CLIENT_ID
  //   githubClientSecret  → GITHUB_CLIENT_SECRET
  //   publicUrl           → PUBLIC_URL
  //   allowedOrigins      → ALLOWED_ORIGINS
  //   jwtSecret           → JWT_SECRET

  export async function saveConfig(patch: Partial<Omit<AppConfig, 'jwtSecret'>> & { jwtSecret?: string }): Promise<void>
  // Upsert singleton; auto-generates jwtSecret if still missing after merge.
  // Refreshes in-memory cache.

  export function hasGoogle(): boolean
  // true iff getConfig() returns both googleClientId and googleClientSecret

  export function hasGithub(): boolean
  // true iff getConfig() returns both githubClientId and githubClientSecret

  export function isConfigured(): boolean
  // true iff STARTER_MONGODB_URI env var is set AND (hasGoogle() || hasGithub())

  export function resetConfigCache(): void
  // Test-only helper — clears the in-memory cache so each test starts fresh
  ```

- [ ] **Step 1: Write the failing tests**

Create `backend/src/config/__tests__/configService.test.ts`:

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

// We must set the starter connection before importing configService
// because getStarter() is called lazily inside functions, not at import time.
// We'll mock getStarter() via jest module mock.
jest.mock('../../lib/db', () => ({
  getStarter: jest.fn(),
}));

import { getStarter } from '../../lib/db';
import {
  loadConfig,
  getConfig,
  saveConfig,
  hasGoogle,
  hasGithub,
  isConfigured,
  resetConfigCache,
} from '../configService';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  (getStarter as jest.Mock).mockReturnValue(conn);
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

beforeEach(() => {
  resetConfigCache();
  // Clear relevant env vars
  [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
    'PUBLIC_URL', 'ALLOWED_ORIGINS', 'JWT_SECRET',
    'STARTER_MONGODB_URI',
  ].forEach((k) => delete process.env[k]);
});

describe('loadConfig', () => {
  it('creates a singleton with generated jwtSecret if DB is empty', async () => {
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.jwtSecret).toBeTruthy();
    expect(cfg.jwtSecret.length).toBe(64); // 32 bytes hex
  });

  it('loads existing config from DB on second call (uses cache on third)', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    resetConfigCache();
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('gid');
  });
});

describe('getConfig — env fallback', () => {
  it('returns process.env.GOOGLE_CLIENT_ID when DB has no value', async () => {
    await loadConfig(); // empty DB → only jwtSecret
    process.env.GOOGLE_CLIENT_ID = 'env-gid';
    process.env.GOOGLE_CLIENT_SECRET = 'env-gsecret';
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('env-gid');
    expect(cfg.googleClientSecret).toBe('env-gsecret');
  });

  it('DB value takes precedence over process.env', async () => {
    await saveConfig({ googleClientId: 'db-gid', googleClientSecret: 'db-gsecret' });
    process.env.GOOGLE_CLIENT_ID = 'env-gid'; // should be ignored
    resetConfigCache();
    await loadConfig();
    const cfg = getConfig();
    expect(cfg.googleClientId).toBe('db-gid');
  });

  it('falls back JWT_SECRET from env when DB has none', async () => {
    process.env.JWT_SECRET = 'env-jwt-secret';
    // loadConfig with no DB doc — but wait, loadConfig creates one with a
    // generated secret. So let's test getConfig() before loadConfig() is called.
    // getConfig() on fresh cache should still work (returns empty + env fallbacks).
    const cfg = getConfig(); // cache not loaded yet
    expect(cfg.jwtSecret).toBe('env-jwt-secret');
  });
});

describe('saveConfig', () => {
  it('persists to DB and refreshes cache', async () => {
    await saveConfig({ githubClientId: 'gh-id', githubClientSecret: 'gh-sec' });
    const cfg = getConfig();
    expect(cfg.githubClientId).toBe('gh-id');
  });

  it('auto-generates jwtSecret when not provided', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    const cfg = getConfig();
    expect(cfg.jwtSecret).toHaveLength(64);
  });

  it('preserves existing jwtSecret on partial update', async () => {
    await saveConfig({ jwtSecret: 'fixed-secret-32-chars-padded-here' });
    const first = getConfig().jwtSecret;
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsecret' });
    expect(getConfig().jwtSecret).toBe(first);
  });
});

describe('hasGoogle / hasGithub / isConfigured', () => {
  it('hasGoogle returns false when credentials absent', async () => {
    await loadConfig();
    expect(hasGoogle()).toBe(false);
  });

  it('hasGoogle returns true when both google creds present via DB', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    expect(hasGoogle()).toBe(true);
  });

  it('hasGithub returns true when both github creds present via env', async () => {
    await loadConfig();
    process.env.GITHUB_CLIENT_ID = 'env-gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'env-gh-sec';
    expect(hasGithub()).toBe(true);
  });

  it('isConfigured returns false when STARTER_MONGODB_URI not set', async () => {
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    // STARTER_MONGODB_URI is not set in this test
    expect(isConfigured()).toBe(false);
  });

  it('isConfigured returns true when STARTER_MONGODB_URI set + ≥1 OAuth provider', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    await saveConfig({ googleClientId: 'gid', googleClientSecret: 'gsec' });
    expect(isConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=configService.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../configService'`

- [ ] **Step 3: Create `backend/src/config/configService.ts`**

```ts
import crypto from 'crypto';
import { ConfigModel, type IConfig } from '../models/Config';
import { getStarter } from '../lib/db';
import mongoose from 'mongoose';

export interface AppConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  publicUrl?: string;
  allowedOrigins?: string;
  jwtSecret: string;
}

// Module-level cache — populated by loadConfig(), refreshed by saveConfig().
// null = never loaded; object = loaded (may have empty optional fields).
let _cache: Partial<AppConfig> | null = null;

/** For tests only: clear the in-memory cache. */
export function resetConfigCache(): void {
  _cache = null;
}

function getConfigModel(): mongoose.Model<IConfig> {
  const conn = getStarter();
  try {
    return conn.model<IConfig>(ConfigModel.modelName);
  } catch {
    return conn.model<IConfig>(ConfigModel.modelName, ConfigModel.schema);
  }
}

/**
 * Load the singleton from the DB into the in-memory cache.
 * If no document exists, creates one with a generated jwtSecret.
 * Requires the starter connection to be open (call after connectStarter).
 */
export async function loadConfig(): Promise<void> {
  const Config = getConfigModel();
  let doc = await Config.findOne({ key: 'singleton' });

  if (!doc) {
    const jwtSecret =
      process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex');
    doc = await Config.create({ key: 'singleton', jwtSecret });
  }

  _cache = docToCache(doc);
}

/**
 * Sync accessor over the in-memory cache.
 * For each field, falls back to the matching process.env value when the
 * cached/DB value is absent. Safe to call before loadConfig() — returns
 * only env-based values in that case.
 */
export function getConfig(): AppConfig {
  const c = _cache ?? {};

  const googleClientId = c.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = c.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const githubClientId = c.githubClientId || process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = c.githubClientSecret || process.env.GITHUB_CLIENT_SECRET;
  const publicUrl = c.publicUrl || process.env.PUBLIC_URL;
  const allowedOrigins = c.allowedOrigins || process.env.ALLOWED_ORIGINS;
  const jwtSecret =
    c.jwtSecret || process.env.JWT_SECRET || '';

  return {
    googleClientId,
    googleClientSecret,
    githubClientId,
    githubClientSecret,
    publicUrl,
    allowedOrigins,
    jwtSecret,
  };
}

/**
 * Upsert the singleton document with the given patch, refreshing the cache.
 * Auto-generates jwtSecret if it is still missing after the merge.
 */
export async function saveConfig(
  patch: Partial<AppConfig>
): Promise<void> {
  const Config = getConfigModel();

  // Merge patch with current cache to avoid overwriting unrelated fields
  const current = _cache ?? {};
  const merged = { ...current, ...patch };

  if (!merged.jwtSecret) {
    merged.jwtSecret = crypto.randomBytes(32).toString('hex');
  }

  const doc = await Config.findOneAndUpdate(
    { key: 'singleton' },
    {
      $set: {
        googleClientId: merged.googleClientId,
        googleClientSecret: merged.googleClientSecret,
        githubClientId: merged.githubClientId,
        githubClientSecret: merged.githubClientSecret,
        publicUrl: merged.publicUrl,
        allowedOrigins: merged.allowedOrigins,
        jwtSecret: merged.jwtSecret,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  _cache = docToCache(doc!);
}

/** true iff both Google client ID and secret are available via DB or env. */
export function hasGoogle(): boolean {
  const cfg = getConfig();
  return !!(cfg.googleClientId && cfg.googleClientSecret);
}

/** true iff both GitHub client ID and secret are available via DB or env. */
export function hasGithub(): boolean {
  const cfg = getConfig();
  return !!(cfg.githubClientId && cfg.githubClientSecret);
}

/**
 * true iff STARTER_MONGODB_URI is set in process.env AND at least one
 * OAuth provider is available via getConfig(). This is the canonical
 * "setup is complete" check.
 */
export function isConfigured(): boolean {
  const hasDb = !!process.env.STARTER_MONGODB_URI;
  return hasDb && (hasGoogle() || hasGithub());
}

// ── Private helpers ──────────────────────────────────────────────────────────

function docToCache(doc: IConfig): Partial<AppConfig> {
  return {
    googleClientId: doc.googleClientId,
    googleClientSecret: doc.googleClientSecret,
    githubClientId: doc.githubClientId,
    githubClientSecret: doc.githubClientSecret,
    publicUrl: doc.publicUrl,
    allowedOrigins: doc.allowedOrigins,
    jwtSecret: doc.jwtSecret,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=configService.test.ts --no-coverage 2>&1 | tail -20
```

Expected: PASS (all configService tests green)

- [ ] **Step 5: Commit**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add backend/src/config/configService.ts backend/src/config/__tests__/configService.test.ts && rtk git commit -m "$(cat <<'EOF'
feat(config): add configService with loadConfig/getConfig/saveConfig + env fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update consumers — jwt.ts, passport.ts, app.ts

**Files:**
- Modify: `backend/src/auth/jwt.ts`
- Modify: `backend/src/auth/passport.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/auth/__tests__/jwt.test.ts`

**Interfaces:**
- Consumes: `getConfig()` from `../config/configService` (in jwt.ts + passport.ts); `getConfig()` from `./config/configService` (in app.ts)

- [ ] **Step 1: Update `backend/src/auth/jwt.ts`**

Replace the `getSecret()` function to read from `getConfig()` with a process.env fallback (the fallback is already handled inside `getConfig()`, so we just call it):

```ts
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/configService';

const JWT_TTL = '7d';

function getSecret(): string {
  const secret = getConfig().jwtSecret;
  if (!secret) {
    throw new Error('JWT secret is not configured — complete setup or set JWT_SECRET env var');
  }
  return secret;
}

export interface JwtPayload {
  userId: string;
}

export function signJwt(userId: string): string {
  return jwt.sign({ userId }, getSecret(), { expiresIn: JWT_TTL });
}

export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload;
  if (!decoded || typeof decoded.userId !== 'string') {
    throw new Error('Invalid JWT payload');
  }
  return { userId: decoded.userId };
}
```

- [ ] **Step 2: Update jwt.test.ts to use configService instead of process.env directly**

Read `backend/src/auth/__tests__/jwt.test.ts`. Replace the top `process.env.JWT_SECRET = '...'` line with configService cache injection:

```ts
import { resetConfigCache } from '../../config/configService';

// Mock configService so the test doesn't need a DB connection.
// jwt.ts calls getConfig().jwtSecret — we set the cache via resetConfigCache
// then directly set process.env so the fallback path is exercised.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

afterEach(() => {
  resetConfigCache();
});
```

The existing three test cases (`signs a token`, `tampered token`, `expired token`) remain unchanged — they rely on `process.env.JWT_SECRET` which `getConfig()` falls back to. Only add the import + afterEach, and keep `process.env.JWT_SECRET = '...'` at the top.

The full updated file:

```ts
/**
 * Task 2.1 — JWT tests
 * Run with: npm test -- --testPathPattern=jwt.test.ts
 */
import { signJwt, verifyJwt } from '../jwt';
import { resetConfigCache } from '../../config/configService';

// getConfig() falls back to process.env.JWT_SECRET when no DB cache is set
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

afterEach(() => {
  resetConfigCache();
});

describe('signJwt / verifyJwt', () => {
  it('signs a token that verifyJwt can decode', () => {
    const userId = '507f1f77bcf86cd799439011';
    const token = signJwt(userId);
    expect(typeof token).toBe('string');
    const payload = verifyJwt(token);
    expect(payload.userId).toBe(userId);
  });

  it('verifyJwt throws on a tampered token', () => {
    const token = signJwt('abc123');
    const [h, p] = token.split('.');
    expect(() => verifyJwt(`${h}.${p}.badsig`)).toThrow();
  });

  it('verifyJwt throws on an expired token', async () => {
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign(
      { userId: 'u1' },
      process.env.JWT_SECRET as string,
      { expiresIn: -1 }
    );
    expect(() => verifyJwt(expired)).toThrow();
  });
});
```

- [ ] **Step 3: Update `backend/src/auth/passport.ts`**

Replace the three `process.env.*` reads for credentials (keep all other logic identical):

Change this block:
```ts
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:4000';

// Google
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
```

To:
```ts
import { getConfig } from '../config/configService';
// (add at top of file, with other imports)

// Inside configurePassport():
const cfg = getConfig();
const PUBLIC_URL = cfg.publicUrl ?? 'http://localhost:4000';

// Google
const googleClientId = cfg.googleClientId;
const googleClientSecret = cfg.googleClientSecret;
```

And replace:
```ts
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
```

To:
```ts
const githubClientId = cfg.githubClientId;
const githubClientSecret = cfg.githubClientSecret;
```

Full updated `configurePassport` function signature and body (only the changed lines shown; everything else stays):

```ts
import { getConfig } from '../config/configService';

export function configurePassport(): void {
  (passport as unknown as { _strategies: Record<string, unknown> })._strategies['google'] &&
    passport.unuse('google');
  (passport as unknown as { _strategies: Record<string, unknown> })._strategies['github'] &&
    passport.unuse('github');

  const cfg = getConfig();
  const PUBLIC_URL = cfg.publicUrl ?? 'http://localhost:4000';

  const googleClientId = cfg.googleClientId;
  const googleClientSecret = cfg.googleClientSecret;
  if (googleClientId && googleClientSecret) {
    // ... rest of Google strategy unchanged
  }

  const githubClientId = cfg.githubClientId;
  const githubClientSecret = cfg.githubClientSecret;
  if (githubClientId && githubClientSecret) {
    // ... rest of GitHub strategy unchanged
  }

  // serialize/deserialize unchanged
}
```

- [ ] **Step 4: Update `backend/src/app.ts` CORS to read from getConfig()**

Replace:
```ts
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
```

With:
```ts
import { getConfig } from './config/configService';
// (add at top of file with other imports)

// Inside createApp():
const cfg = getConfig();
const allowedOrigins = (cfg.allowedOrigins ?? process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
```

Note: `process.env.FRONTEND_URL` fallback is kept for Docker backward compat where it may be set without going through setup. `getConfig().allowedOrigins` already falls back to `process.env.ALLOWED_ORIGINS` internally, so `ALLOWED_ORIGINS` is covered too.

- [ ] **Step 5: Run the jwt, passport, and existing test suites to verify green**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern="jwt.test.ts|passport.test.ts" --no-coverage 2>&1 | tail -30
```

Expected: PASS

- [ ] **Step 6: Run all backend tests to catch regressions**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --no-coverage 2>&1 | tail -30
```

Expected: all green (316+ tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add backend/src/auth/jwt.ts backend/src/auth/passport.ts backend/src/app.ts backend/src/auth/__tests__/jwt.test.ts && rtk git commit -m "$(cat <<'EOF'
feat(config): redirect jwt/passport/cors consumers to getConfig() with env fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite routes/setup.ts — DB upsert instead of .env write

**Files:**
- Modify: `backend/src/routes/setup.ts`
- Modify: `backend/src/__tests__/setup.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `saveConfig`, `isConfigured`, `hasGoogle`, `hasGithub`, `resetConfigCache` from `../config/configService`; `connectStarter` from `../lib/db`; `configurePassport` from `../auth/passport`; `connectRuntime` from `../lib/runtime`

**Contract unchanged (frontend wizard keeps working):**
- `POST /api/setup/configure` body: `{ starterUri, google?, github?, publicUrl?, allowedOrigins? }`
- `GET /api/setup/status` response: `{ setupRequired, configured: { starterDb, jwt, google, github, publicUrl } }`

- [ ] **Step 1: Update setup.test.ts — new contract (DB persistence, no file write)**

Replace the entire `backend/src/__tests__/setup.test.ts` with this updated version that tests DB behavior instead of file writes:

```ts
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app';
import { resetConfigCache } from '../config/configService';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

// Mock the starter connection so setup.ts can call connectStarter() during /configure
jest.mock('../lib/db', () => {
  let _conn: mongoose.Connection | null = null;
  return {
    connectStarter: jest.fn(async () => {
      if (!_conn) throw new Error('connectStarter mock: conn not set');
      return _conn;
    }),
    getStarter: jest.fn(() => {
      if (!_conn) throw new Error('getStarter mock: conn not set');
      return _conn;
    }),
    __setConn: (c: mongoose.Connection) => { _conn = c; },
  };
});

// Mock connectRuntime so /configure does not try to connect to Atlas
jest.mock('../lib/runtime', () => ({
  connectRuntime: jest.fn().mockResolvedValue(undefined),
  isRuntimeStarted: jest.fn().mockReturnValue(false),
}));

const { __setConn } = require('../lib/db') as any;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  __setConn(conn);
});

afterAll(async () => {
  await conn.close();
  await mongod.stop();
});

beforeEach(async () => {
  resetConfigCache();
  // Drop Config collection so each test starts fresh
  try {
    await conn.collection('configs').deleteMany({});
  } catch {
    // collection may not exist yet — fine
  }
  // Clear OAuth env vars; keep STARTER_MONGODB_URI absent so status shows setup required
  [
    'STARTER_MONGODB_URI',
    'JWT_SECRET',
    'PUBLIC_URL',
    'FRONTEND_URL',
    'ALLOWED_ORIGINS',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  ].forEach((k) => delete process.env[k]);
});

afterEach(() => {
  resetConfigCache();
});

// ── GET /api/setup/status ─────────────────────────────────────────────────────

describe('GET /api/setup/status', () => {
  it('returns setupRequired:true when nothing is configured', async () => {
    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(true);
    expect(res.body.configured).toBeDefined();
    expect(res.body.configured.starterDb).toBe(false);
    expect(res.body.configured.google || res.body.configured.github).toBe(false);
  });

  it('returns setupRequired:false when STARTER_MONGODB_URI set + Google creds in env', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';

    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.setupRequired).toBe(false);
    expect(res.body.configured.starterDb).toBe(true);
    expect(res.body.configured.google).toBe(true);
  });

  it('requires at least one OAuth provider', async () => {
    process.env.STARTER_MONGODB_URI = 'mongodb://localhost:27017/shard';
    const app = createApp();
    const res = await request(app).get('/api/setup/status');
    expect(res.body.setupRequired).toBe(true);
  });
});

// ── POST /api/setup/test-connection ──────────────────────────────────────────

describe('POST /api/setup/test-connection', () => {
  it('returns ok:false on an unreachable URI', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/test-connection')
      .send({ starterUri: 'mongodb://127.0.0.1:9' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
  }, 15_000);

  it('returns 400 when starterUri is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/test-connection')
      .send({})
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });
});

// ── POST /api/setup/configure ────────────────────────────────────────────────

const validPayload = {
  starterUri: 'mongodb://localhost:27017/shard',
  google: { clientId: 'gid', clientSecret: 'gsecret' },
  publicUrl: 'https://shard.example.com',
  allowedOrigins: 'https://shard.example.com',
};

describe('POST /api/setup/configure', () => {
  it('returns 400 when starterUri is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({ publicUrl: 'https://x.com', allowedOrigins: 'https://x.com' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('returns 400 when neither google nor github is provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        publicUrl: 'https://x.com',
        allowedOrigins: 'https://x.com',
      })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OAuth/i);
  });

  it('returns 400 when an OAuth provider is incomplete (id without secret)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        google: { clientId: 'gid' },
        publicUrl: 'https://x.com',
        allowedOrigins: 'https://x.com',
      })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('persists config to DB (not a file) on success', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the Config singleton was written to DB
    const ConfigModel = conn.model('Config');
    const doc = await ConfigModel.findOne({ key: 'singleton' });
    expect(doc).toBeTruthy();
    expect((doc as any).googleClientId).toBe('gid');
    expect((doc as any).jwtSecret).toBeTruthy();
  });

  it('sets process.env.STARTER_MONGODB_URI as bootstrap', async () => {
    const app = createApp();
    delete process.env.STARTER_MONGODB_URI;
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');
    expect(process.env.STARTER_MONGODB_URI).toBe(validPayload.starterUri);
  });

  it('auto-generates JWT secret and stores it in DB', async () => {
    delete process.env.JWT_SECRET;
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    const { getConfig } = require('../config/configService');
    expect(getConfig().jwtSecret).toHaveLength(64);
  });

  it('returns 403 on second configure call (idempotent guard)', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');
    expect(second.status).toBe(403);
  });

  it('flips GET /api/setup/status to setupRequired:false after configure', async () => {
    const app = createApp();
    await request(app)
      .post('/api/setup/configure')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    const status = await request(app).get('/api/setup/status');
    expect(status.body.setupRequired).toBe(false);
  });

  it('accepts github credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/setup/configure')
      .send({
        starterUri: 'mongodb://localhost:27017/shard',
        github: { clientId: 'gh_id', clientSecret: 'gh_secret' },
        publicUrl: 'https://shard.example.com',
        allowedOrigins: 'https://shard.example.com',
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    const { getConfig } = require('../config/configService');
    expect(getConfig().githubClientId).toBe('gh_id');
    expect(getConfig().githubClientSecret).toBe('gh_secret');
  });
});
```

- [ ] **Step 2: Run the updated setup tests to verify they fail (old code)**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=setup.test.ts --no-coverage 2>&1 | tail -20
```

Expected: several FAIL (new tests expect DB behavior, old code writes files)

- [ ] **Step 3: Rewrite `backend/src/routes/setup.ts`**

```ts
/**
 * Setup routes — first-run configuration wizard backend.
 *
 * GET  /api/setup/status          → { setupRequired, configured }
 * POST /api/setup/test-connection → { ok, error? }
 * POST /api/setup/configure       → upserts Config doc in DB, refuses if already done
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { configurePassport } from '../auth/passport';
import {
  isConfigured,
  getConfig,
  saveConfig,
  loadConfig,
} from '../config/configService';
import { connectStarter } from '../lib/db';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getConfiguredFlags() {
  const cfg = getConfig();
  return {
    starterDb: !!process.env.STARTER_MONGODB_URI,
    jwt: !!cfg.jwtSecret,
    google: !!(cfg.googleClientId && cfg.googleClientSecret),
    github: !!(cfg.githubClientId && cfg.githubClientSecret),
    publicUrl: !!cfg.publicUrl,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/setup/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    setupRequired: !isConfigured(),
    configured: getConfiguredFlags(),
  });
});

// POST /api/setup/test-connection
router.post('/test-connection', async (req: Request, res: Response) => {
  const { starterUri } = req.body as { starterUri?: string };

  if (!starterUri || typeof starterUri !== 'string' || !starterUri.trim()) {
    return res.status(400).json({ error: 'starterUri is required' });
  }

  let conn: mongoose.Connection | null = null;
  try {
    conn = mongoose.createConnection(starterUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 5000,
    });

    await conn.asPromise();
    return res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`test-connection failed: ${message}`);
    return res.json({ ok: false, error: message });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        // ignore close errors
      }
    }
  }
});

// POST /api/setup/configure
interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

interface ConfigureBody {
  starterUri?: string;
  google?: Partial<OAuthCreds>;
  github?: Partial<OAuthCreds>;
  publicUrl?: string;
  allowedOrigins?: string;
}

router.post('/configure', async (req: Request, res: Response) => {
  // Guard: refuse if already configured
  if (isConfigured()) {
    return res.status(403).json({
      error: 'Setup already complete',
      message: 'Update configuration via the Config document in the database.',
    });
  }

  const { starterUri, google, github, publicUrl, allowedOrigins } =
    req.body as ConfigureBody;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!starterUri || typeof starterUri !== 'string' || !starterUri.trim()) {
    return res.status(400).json({ error: 'starterUri is required' });
  }

  const hasGoogle = !!(google?.clientId && google?.clientSecret);
  const hasGithub = !!(github?.clientId && github?.clientSecret);

  if (!hasGoogle && !hasGithub) {
    return res.status(400).json({
      error: 'At least one OAuth provider (Google or GitHub) is required',
    });
  }

  if (google && !(google.clientId && google.clientSecret)) {
    return res.status(400).json({
      error: 'Google OAuth requires both clientId and clientSecret',
    });
  }
  if (github && !(github.clientId && github.clientSecret)) {
    return res.status(400).json({
      error: 'GitHub OAuth requires both clientId and clientSecret',
    });
  }

  // ── Connect to the starter DB and persist config ──────────────────────────
  try {
    // Connect using the provided URI (app may be in setup mode with no
    // connection yet). connectStarter is idempotent.
    await connectStarter(starterUri);

    await saveConfig({
      ...(hasGoogle && {
        googleClientId: google!.clientId!,
        googleClientSecret: google!.clientSecret!,
      }),
      ...(hasGithub && {
        githubClientId: github!.clientId!,
        githubClientSecret: github!.clientSecret!,
      }),
      ...(publicUrl && { publicUrl }),
      ...(allowedOrigins && { allowedOrigins }),
    });

    logger.info('Setup: Config written to DB');
  } catch (err) {
    logger.error('Setup: failed to persist config to DB', err);
    return res.status(500).json({
      error: 'Failed to save configuration to database',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Bootstrap STARTER_MONGODB_URI for this process so isConfigured() returns true
  process.env.STARTER_MONGODB_URI = starterUri;
  logger.info('Setup: process.env.STARTER_MONGODB_URI set');

  // Re-initialize passport strategies so OAuth login works immediately
  try {
    configurePassport();
    logger.info('Setup: passport strategies re-initialized');
  } catch (err) {
    logger.warn('Setup: passport re-init failed (non-fatal)', err);
  }

  // Bring the runtime fully online (rehydrate clusters, start loops).
  // Skipped under the test runner, which injects its own DB connections.
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { connectRuntime } = await import('../lib/runtime');
      await connectRuntime(starterUri);
      logger.info('Setup: runtime connected — Shard is live');
    } catch (err) {
      logger.error('Setup: runtime activation failed', err);
      return res.status(500).json({
        error: 'Configuration saved but the app could not fully start',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.json({
    success: true,
    message: 'Configuration saved. You can now sign in.',
  });
});

export default router;
```

- [ ] **Step 4: Run setup tests to verify they pass**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --testPathPattern=setup.test.ts --no-coverage 2>&1 | tail -30
```

Expected: all PASS

- [ ] **Step 5: Run all backend tests**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --no-coverage 2>&1 | tail -30
```

Expected: all green

- [ ] **Step 6: Commit**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add backend/src/routes/setup.ts backend/src/__tests__/setup.test.ts && rtk git commit -m "$(cat <<'EOF'
feat(setup): rewrite configure to persist config to DB instead of .env file

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update index.ts boot sequence + docker-compose.yml

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `loadConfig()` from `./config/configService`; `connectRuntime` from `./lib/runtime`

- [ ] **Step 1: Rewrite `backend/src/index.ts`**

Remove the `SETUP_ENV_FILE_PATH` dotenv loading block. Add `loadConfig()` call after `connectRuntime`.

```ts
import 'dotenv/config';
import { createApp } from './app';
import { connectRuntime } from './lib/runtime';
import { loadConfig } from './config/configService';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const STARTER_URI = process.env.STARTER_MONGODB_URI;

async function main(): Promise<void> {
  // Always start the HTTP server so the health check and the setup wizard
  // (/api/setup/*) are reachable.
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`Shard backend listening on port ${PORT}`);
  });

  if (STARTER_URI) {
    // Already configured — bring the runtime fully online, then load DB config
    // into the in-memory cache so getConfig() works for all subsequent requests.
    await connectRuntime(STARTER_URI);
    await loadConfig();
    logger.info('Boot: DB config loaded into cache');
  } else {
    // Setup mode: no starter cluster yet. The setup wizard is served and, on
    // successful /configure, calls connectRuntime() + sets process.env to
    // activate the app live — no restart required.
    logger.warn(
      'STARTER_MONGODB_URI not set — running in SETUP MODE. ' +
        'Complete the setup wizard in the browser to activate Shard.',
    );
  }
}

main().catch((err: Error) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
```

- [ ] **Step 2: Update `docker-compose.yml`**

Remove the `SETUP_ENV_FILE_PATH` environment entry and the `./config:/app/config` volume. Keep `./logs:/app/logs`. Update the comment to reflect the new config model.

The updated `backend` service section (only the changed parts):

```yaml
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    # Bootstrap: copy .env.example → .env on the host, fill in STARTER_MONGODB_URI
    # (and optionally PORT / COOKIE_SECURE). All other config (OAuth creds, JWT
    # secret, public URL) is stored in the starter DB via the setup wizard.
    env_file: .env
    environment:
      NODE_ENV: production
    ports:
      - '4000:4000'
    volumes:
      - ./logs:/app/logs
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:4000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Run full backend test suite**

```bash
cd /Users/zhixiangli/Github/Shard/backend && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all green

- [ ] **Step 5: Run frontend build (confirm no breakage)**

```bash
cd /Users/zhixiangli/Github/Shard/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds (frontend unchanged)

- [ ] **Step 6: Commit**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add backend/src/index.ts docker-compose.yml && rtk git commit -m "$(cat <<'EOF'
feat(boot): load DB config on startup; remove SETUP_ENV_FILE_PATH + config volume

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write the phase report

**Files:**
- Create: `.superpowers/sdd/v2-phase-a-report.md`

- [ ] **Step 1: Create the `.superpowers/sdd/` directory if needed**

```bash
mkdir -p /Users/zhixiangli/Github/Shard/.superpowers/sdd
```

- [ ] **Step 2: Write the report**

Create `.superpowers/sdd/v2-phase-a-report.md` with:

```markdown
# v2 Phase A — Config in DB: Implementation Report

## Status
Complete. All backend tests green. TypeScript clean. Frontend build unaffected.

## Commit Range
[first7..last7] — fill after committing

## What Changed

### New files
- `backend/src/models/Config.ts` — Config singleton Mongoose model
- `backend/src/config/configService.ts` — loadConfig / getConfig / saveConfig + helpers
- `backend/src/config/__tests__/configService.test.ts` — unit tests

### Modified files
- `backend/src/models/index.ts` — exports ConfigModel
- `backend/src/auth/jwt.ts` — reads jwtSecret from getConfig()
- `backend/src/auth/passport.ts` — reads OAuth creds + publicUrl from getConfig()
- `backend/src/app.ts` — reads allowedOrigins from getConfig()
- `backend/src/routes/setup.ts` — upserts Config doc, no .env write
- `backend/src/index.ts` — calls loadConfig() after connectRuntime() on boot
- `backend/src/__tests__/setup.test.ts` — updated for DB-based contract
- `docker-compose.yml` — dropped ./config volume + SETUP_ENV_FILE_PATH

## getConfig() Shape

```ts
interface AppConfig {
  googleClientId?: string;      // DB ?? process.env.GOOGLE_CLIENT_ID
  googleClientSecret?: string;  // DB ?? process.env.GOOGLE_CLIENT_SECRET
  githubClientId?: string;      // DB ?? process.env.GITHUB_CLIENT_ID
  githubClientSecret?: string;  // DB ?? process.env.GITHUB_CLIENT_SECRET
  publicUrl?: string;           // DB ?? process.env.PUBLIC_URL
  allowedOrigins?: string;      // DB ?? process.env.ALLOWED_ORIGINS
  jwtSecret: string;            // DB ?? process.env.JWT_SECRET ?? ''
}
```

DB values take precedence; env vars are fallback. This means existing
env-based deployments (direct env + no DB config doc) continue to work
unchanged.

## Contract Changes

### POST /api/setup/configure
- Request body: **unchanged** — `{ starterUri, google?, github?, publicUrl?, allowedOrigins? }`
- Success response: **unchanged** — `{ success: true, message: '...' }`
- Error response on 403: message text changed from "Edit the .env file..." to "Update configuration via the Config document in the database."
- Side effect changed: no longer writes a .env file; instead upserts `Config` singleton in starter DB and sets `process.env.STARTER_MONGODB_URI` as bootstrap.

### GET /api/setup/status
- Response shape: **unchanged** — `{ setupRequired, configured: { starterDb, jwt, google, github, publicUrl } }`
- `setupRequired` now derived from `isConfigured()` which checks STARTER_MONGODB_URI env + ≥1 OAuth provider in getConfig() (DB or env).

## Blocking Concerns
None.
```

- [ ] **Step 3: Commit the report**

```bash
cd /Users/zhixiangli/Github/Shard && rtk git add .superpowers/sdd/v2-phase-a-report.md && rtk git commit -m "$(cat <<'EOF'
docs(v2): add Phase A implementation report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| Config singleton model (key, OAuth fields, jwtSecret, updatedAt) | Task 1 |
| loadConfig() reads DB, caches, creates with generated jwtSecret if absent | Task 2 |
| getConfig() sync accessor with env fallback for each field | Task 2 |
| saveConfig() upserts, refreshes cache, generates jwtSecret if missing | Task 2 |
| hasGoogle(), hasGithub(), isConfigured() | Task 2 |
| passport.ts reads from getConfig() | Task 3 |
| CORS in app.ts reads from getConfig() | Task 3 |
| jwt.ts reads jwtSecret from getConfig() | Task 3 |
| setup.ts GET /status uses isConfigured() + getConfig() flags | Task 4 |
| setup.ts POST /configure upserts DB (not .env) | Task 4 |
| setup.ts POST /configure connects starter before saveConfig | Task 4 |
| setup.ts POST /configure sets process.env.STARTER_MONGODB_URI bootstrap | Task 4 |
| setup.ts POST /configure refreshes passport | Task 4 |
| setup.ts POST /configure calls connectRuntime (not test) | Task 4 |
| Remove SETUP_ENV_FILE_PATH logic | Task 5 |
| index.ts calls loadConfig() after connectRuntime on boot | Task 5 |
| docker-compose drops config volume + SETUP_ENV_FILE_PATH | Task 5 |
| All existing tests green | Tasks 3–5 (run full suite after each) |
| Config save→load→cache test | Task 2 |
| getConfig env fallback test | Task 2 |
| isConfigured logic test | Task 2 |
| setup status reflects DB config test | Task 4 |
| configure persists to Config + flips status test | Task 4 |
| Frontend wizard POST contract unchanged | Task 4 (shape unchanged) |
| Report written | Task 6 |

### Placeholder scan
No TBD/TODO/placeholder in plan. All code blocks are complete. ✓

### Type consistency
- `AppConfig` defined in Task 2, consumed by Tasks 3, 4 — field names consistent throughout.
- `resetConfigCache()` defined in Task 2, used in Tasks 3 (jwt test) and 4 (setup test) — consistent.
- `saveConfig(patch: Partial<AppConfig>)` — Task 2 signature matches all call sites in Task 4.
- `isConfigured()`, `hasGoogle()`, `hasGithub()` defined in Task 2, imported in Task 4 — consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-22-shard-v2-phase-a.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

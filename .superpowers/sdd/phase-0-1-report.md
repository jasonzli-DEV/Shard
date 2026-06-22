# Phase 0 + Phase 1 Implementation Report

**Date:** 2026-06-22  
**Commit range:** eb3f05a..0d97185  
**Status:** DONE

---

## What Was Built

### Phase 0 — Monorepo Scaffold (Task 0.1)

**Root:**
- `/Users/zhixiangli/Github/Shard/package.json` — npm workspaces (`backend`, `frontend`), `concurrently` for parallel dev
- `/Users/zhixiangli/Github/Shard/.env.example` — all required env vars: `PORT`, `STARTER_MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `PUBLIC_URL`, `LOG_LEVEL`
- `/Users/zhixiangli/Github/Shard/docker-compose.yml` — `backend` (node:20) + `frontend` (nginx); no local DB service (uses remote Atlas)
- `/Users/zhixiangli/Github/Shard/README.md`

**Backend (`backend/`):**
- `package.json` — runtime deps: express, mongoose, jsonwebtoken, cookie-parser, cors, multer, passport, passport-google-oauth20, passport-github2, winston, nanoid, dotenv; dev: typescript, ts-node-dev, jest, ts-jest, @types/*, supertest, mongodb-memory-server
- `tsconfig.json` — strict mode, ES2022, CommonJS output
- `jest.config.js` — ts-jest preset, testEnvironment node, 60s timeout
- `Dockerfile` — multi-stage: builder (tsc) → runtime (node:20-alpine, non-root user)

**Frontend (`frontend/`):**
- `package.json` — React 18, react-router-dom, @tanstack/react-query, axios, vite, vitest, @testing-library/react
- `tsconfig.json` + `tsconfig.node.json` — strict, bundler module resolution
- `vite.config.ts` — @vitejs/plugin-react, dev proxy `/api` → `http://localhost:4000`, vitest jsdom
- `index.html`, `src/main.tsx`, `src/App.tsx` — minimal shell that builds successfully
- `Dockerfile` — multi-stage: builder (npm run build) → nginx:alpine serving dist/
- `nginx.conf` — proxy `/api/` to `backend:4000`, SPA fallback, security headers, gzip, aggressive static caching

**Health endpoint (TDD):**
- Test written first: `backend/src/__tests__/health.test.ts` — confirmed RED (TS2307 module not found)
- Implemented `backend/src/app.ts` with `createApp()` factory (no `listen`, fully testable)
- `GET /api/health` → `{ status: 'ok' }`
- Confirmed GREEN with supertest

### Phase 1 — DB Connection + Models (Tasks 1.1, 1.2)

**Task 1.1: DB connection + logger**

- `backend/src/lib/db.ts`
  - `connectStarter(uri: string): Promise<mongoose.Connection>` — uses `mongoose.createConnection()` (isolated from default connection), idempotent, logs on connect/error/disconnect
  - `getStarter(): mongoose.Connection` — throws if not initialised
  - `closeStarter(): Promise<void>` — resets state (used in tests + graceful shutdown)
- `backend/src/utils/logger.ts` — Winston: JSON+timestamp format, file transports (`logs/error.log`, `logs/combined.log`), console transport silenced in `NODE_ENV=test`
- `backend/src/index.ts` — entrypoint: loads dotenv, connects starter, calls `createApp()`, listens on `PORT`

DB tests (3 cases) — all GREEN:
- `connectStarter` returns connected instance, `getStarter` returns same
- `getStarter` throws when called before `connectStarter`
- `connectStarter` is idempotent

**Task 1.2: Mongoose models**

All 9 models in `backend/src/models/`:

| Model | File | Key unique indexes |
|-------|------|--------------------|
| User | `User.ts` | `(provider, providerId)` |
| OrgKey | `OrgKey.ts` | none unique (userId indexed) |
| StorageCluster | `StorageCluster.ts` | `clusterId` |
| File | `File.ts` | `(userId, path)` |
| Blob | `Blob.ts` | `(fileId, index)` |
| ApiKey | `ApiKey.ts` | `key` |
| Session | `Session.ts` | `token`; TTL on `expiresAt` |
| Share | `Share.ts` | `(fileId, sharedWithId)` |
| PublicLink | `PublicLink.ts` | `slug`; TTL on `expiresAt` |

Barrel export: `backend/src/models/index.ts`

Model tests (17 cases) — all GREEN. Each model tested for:
1. Creating a valid document with correct defaults
2. Enforcing its named unique index (duplicate key error)
3. Where applicable: confirming the constraint is scoped correctly (e.g. same path different users is allowed)

---

## Test Results

```
> @shard/backend@0.1.0 test
> jest --runInBand --forceExit

PASS src/models/__tests__/models.test.ts
PASS src/__tests__/db.test.ts
PASS src/__tests__/health.test.ts

Test Suites: 3 passed, 3 total
Tests:       21 passed, 21 total
Snapshots:   0 total
Time:        2.737 s
```

**TypeScript (backend):** `npx tsc --noEmit` — no errors

**Frontend build:**
```
> tsc && vite build
✓ 30 modules transformed.
dist/index.html       0.32 kB │ gzip: 0.23 kB
dist/assets/index-*.js  142.75 kB │ gzip: 45.83 kB
✓ built in 245ms
```

---

## Deviations and Design Decisions

1. **`createApp()` factory pattern** — express app is created via an exported factory function rather than a module-level singleton. This makes supertest tests trivial (no listen required) and avoids port collisions. The `index.ts` entrypoint calls `createApp()` then `listen()`.

2. **Logger silenced in test env** — Winston console transport has `silent: process.env.NODE_ENV === 'test'` to keep test output clean.

3. **`StorageCluster.storageCapacityBytes` default = 512 MB** — hardcoded as the default value on the schema field (matches the 512MB M0 limit from global constraints). Can be overridden per-cluster if needed.

4. **Session + PublicLink TTL indexes** — both use MongoDB's `expireAfterSeconds: 0` on the `expiresAt` field so MongoDB auto-purges expired documents. This is more efficient than a cron job.

5. **`nanoid` v3** — pinned to v3 (CommonJS compatible). nanoid v4+ is ESM-only and breaks ts-jest without additional config.

6. **Root `npm install` installs `concurrently`** — the root workspace installs only `concurrently`. All other deps are in their respective workspace packages.

7. **Node 26** — the host machine runs Node 26, not Node 20. All code was written against Node 20 types/targets (`@types/node@20`) and the tsconfig targets ES2022, so there are no incompatibilities. Docker images use `node:20-alpine` as specified.

---

## No Blockers

All deliverables for Phase 0 (Task 0.1) and Phase 1 (Tasks 1.1, 1.2) are complete, tested, and passing.

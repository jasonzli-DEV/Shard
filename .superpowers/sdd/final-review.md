# Shard — Final Production-Readiness Review

Branch `main`, greenfield, target deploy: Raspberry Pi (arm64) Docker, replacing a live app.
Reviewed source directly (not a diff). Intentional design decisions (plaintext Atlas
credentials in starter DB, dual-conn-to-same-URI metadata model, M0 packing math,
SHARD_E2E test login) were **not** flagged as vulns per the brief.

**Summary: 3 Critical · 5 Important · 6 Minor**

---

## CRITICAL

### C1. Storage cluster connections are never re-opened on startup — all file I/O breaks after a restart/redeploy
**Files:** `backend/src/index.ts:11-35`, `backend/src/storage/clusterManager.ts:24-48`, `backend/src/storage/provisioner.ts:119-135`

The in-memory `connections`/`gridFSBuckets` maps in `clusterManager.ts` are only populated
by `openCluster()`, which is called in exactly three places: `provisionNextCluster`,
`ensureCapacity → provisionNextCluster`, and the E2E login route. **Nothing rehydrates
existing clusters at boot.** `index.ts` connects the starter + default mongoose
connections and starts the scheduler loops, but never iterates existing `StorageCluster`
docs to `openCluster()` them.

Consequences after the very first Pi reboot or container redeploy (i.e. immediately, since
this replaces a live app):
- **Download** (`storageService.readFile → getBucket`) returns `null` →
  `"No GridFS bucket for cluster …"` → 500 for every existing file.
- **Upload to an existing active cluster**: `ensureCapacity()` returns the active cluster
  *without opening it* (it only opens when it provisions a *new* one). `storeFile` then
  calls `getBucket(cluster.clusterId)` → `null` → throws → upload fails and rolls back.
- **Autoscaler** `runStorageCheck()` does `connections.get(cluster.clusterId)` → undefined →
  `{ checked: false }`, so usage is never measured and pre-warm never fires.

This is the single biggest blocker — the app cannot serve any pre-existing user data after a
restart.

**Fix:** In `index.ts` (after connecting starter), load all non-decommissioned
`StorageClusterModel` docs and `await openCluster({clusterId, connectionUri, userId, status})`
for each (tolerate per-cluster failures, log them). Alternatively make `getBucket` lazy:
have it look up the `StorageCluster` doc by `clusterId` and `openCluster()` on demand if the
connection is missing. The lazy approach also fixes `ensureCapacity` returning an unopened
active cluster.

### C2. Backend Dockerfile installs production-only deps before building TypeScript — build fails
**File:** `backend/Dockerfile:5-11`

```
RUN npm ci --only=production     # devDeps (typescript, @types, etc.) NOT installed
...
RUN npm run build                # tsc — not present → build fails
```

The builder stage omits devDependencies, then runs `npm run build` (tsc). `tsc` lives in
devDependencies, so the image build aborts. This blocks the Docker deploy outright.

**Fix:** In the builder stage use `RUN npm ci` (full install). Keep `npm ci --omit=dev`
(modern flag; `--only=production` is deprecated) only in the runtime stage. Verify
`npm run build` actually emits to `dist/` (runtime copies `/app/dist`).

### C3. Setup wizard cannot bootstrap config in the Docker deployment
**Files:** `backend/src/routes/setup.ts:19-21,168-214`, `docker-compose.yml:8`, `backend/Dockerfile:24-26`

`getEnvFilePath()` writes to `path.join(process.cwd(), '..', '.env')` = `/.env` (cwd is
`/app`). Problems compound:
1. The container runs as non-root `USER shard` (Dockerfile:26) and cannot write to `/`.
2. Even if it could, compose reads `env_file: .env` **from the host** at container-start; a
   file written inside the container never reaches the host and requires a restart anyway.
3. `process.env` updates done in-process (`setup.ts:211`) don't re-register passport
   strategies (see I3), so OAuth still won't work until a manual restart with a real `.env`.
4. `docker-compose.yml` references `env_file: .env` with no committed `.env`; if absent,
   `docker compose up` errors.

Net: the "trivial setup" wizard is non-functional under the shipped Docker setup, and there
is no `.env` to start from.

**Fix:** Document that the operator must create `.env` on the host before
`docker compose up` (provide it from `.env.example`). If the in-app wizard is meant to work
in Docker, mount a writable config volume, point `SETUP_ENV_FILE_PATH` at it, ensure the
`shard` user owns it, and trigger a strategy re-registration (or a controlled restart) after
`/configure`. At minimum, gate the deploy on a pre-provisioned `.env`.

---

## IMPORTANT

### I1. Public-link and authenticated downloads serve soft-deleted (trashed) files
**Files:** `backend/src/services/publicLinks.ts:114-130`, `backend/src/routes/publicLinks.ts:72-100`, `backend/src/routes/files.ts:159-205`

`resolveSlug()` fetches the file by id and checks link expiry but **never checks
`file.deletedAt`**. A user can trash a file (or it can be soft-deleted) while a public link
remains live, and `GET /api/public/:slug/download` will still stream the bytes (blobs are not
removed on soft-delete — only on `purge`). The authenticated `GET /api/files/:id/download`
and v1 download likewise don't exclude `deletedAt`. Expiry-scoping to the single linked file
is correct; the deleted-state gap is the issue.

**Fix:** In `resolveSlug` (and the download routes) treat `file.deletedAt != null` as
404/410. Consider also deleting/disabling public links when a file is trashed or purged
(currently `purge` removes blobs/file but leaves dangling `PublicLink` docs).

### I2. `Secure` session cookie will be rejected over plain HTTP — login silently fails on the Pi
**Files:** `backend/src/routes/auth.ts:111-116,130-134`, `frontend/nginx.conf:1-2`, `docker-compose.yml` (frontend `ports: 80:80`)

The OAuth callback sets the cookie with `secure: process.env.NODE_ENV === 'production'`
(compose sets `NODE_ENV: production`). nginx serves on port 80 with no TLS. Browsers reject
`Secure` cookies sent over `http://`, so after OAuth the cookie is dropped and the user lands
back unauthenticated with no error. Works only if the operator fronts the Pi with HTTPS.

**Fix:** Either terminate TLS in front of nginx (and document it as required), or make the
`secure` flag configurable (e.g. `COOKIE_SECURE` env, defaulting on but allow off for
LAN/HTTP installs). Note the same `secure` flag is on `clearCookie` in logout — keep them
consistent.

### I3. OAuth strategies are registered once at boot; runtime setup wizard can't enable login without a restart
**Files:** `backend/src/app.ts:44`, `backend/src/auth/passport.ts:79-146`, `backend/src/routes/setup.ts:210-214`

`configurePassport()` runs once during `createApp()` and only registers Google/GitHub
strategies whose env vars are present **at that moment**. The setup wizard writes creds into
`process.env` later, but never re-runs `configurePassport()`. So immediately post-setup,
`GET /api/auth/google` throws "Unknown authentication strategy" (500). Combined with C3 this
makes first-run-via-wizard non-working.

**Fix:** Re-invoke `configurePassport()` (clearing prior strategies) at the end of
`/api/setup/configure`, or require strategies to be present via `.env` before boot and treat
the wizard as a `.env` generator that mandates a restart (document it).

### I4. Upload spill skips filling a partially-used cluster — wastes capacity and can prematurely report STORAGE_FULL
**Files:** `backend/src/storage/storageService.ts:73-104`, `backend/src/storage/provisioner.ts:119-135`

In the split loop, `ensureCapacity(userId, payload.length - offset)` is asked for room for the
**entire remaining payload**. `ensureCapacity` returns the active cluster only if
`free >= neededBytes` (the whole remainder); otherwise it immediately
`provisionNextCluster()`. So when a file is larger than the active cluster's remaining free
space, the existing cluster's free bytes are never used — the code jumps straight to a fresh
cluster. This wastes up to ~492MB per partially-filled cluster, accelerates org-cap
exhaustion (250 clusters/org), and can surface `STORAGE_FULL` far earlier than real usage
warrants. The split/reassembly *mechanics* (per-blob `index`, ordered reassembly in
`readFile`) are otherwise correct.

**Fix:** Have `storeFile` request only `min(remaining, 1)`-style capacity (i.e. ask for "any
room", pack the active cluster's remainder, then provision for the overflow), or change
`ensureCapacity` to return the active cluster whenever it has *any* usable free space and let
the caller chunk to `free`. The chunking math (`chunkSize = min(free, remaining)`) already
supports partial fills — only the provisioning gate is wrong.

### I5. `waitForCluster` polls forever with no timeout — a stuck Atlas provision hangs the request/scheduler indefinitely
**File:** `backend/src/atlas/client.ts:188-200`

`for (;;)` loops until `stateName === 'IDLE'` with no max attempts/deadline. If Atlas never
reaches IDLE (quota error, region issue, account suspension), `provisionNextCluster` —
called inline from the synchronous upload path via `ensureCapacity`, and from the scheduler —
never returns. The HTTP upload hangs; the scheduler loop wedges.

**Fix:** Add a deadline (e.g. max N minutes / M polls); on timeout throw a typed error so
`storeFile` rolls back and the route returns a real error. Also handle non-IDLE terminal
states (`CREATING` stuck, error states) explicitly.

---

## MINOR

### M1. Dual mongoose connection is fragile though currently coherent
**Files:** `backend/src/index.ts:18-22`, `backend/src/middleware/auth.ts`, all `models/*`

Auth/session/user/orgkey/storage routes resolve models on the *named* starter connection
(`getStarter()`), while `FileModel`, `BlobModel`, `StorageClusterModel`, `ShareModel`,
`PublicLinkModel` are used directly off the **default** mongoose connection. `index.ts`
points **both** at `STARTER_URI`, so they hit the same physical database — no split-brain in
production. But it's two driver connections to one DB for no benefit, and a future change that
points the default connection elsewhere (the comment says it's "reserved for per-user
clusters") would silently break file metadata. Recommend collapsing onto one connection for
metadata, or documenting the invariant loudly.

### M2. `purge` leaves dangling Share and PublicLink documents
**Files:** `backend/src/services/files.ts:320-349`, `backend/src/services/shares.ts`, `backend/src/services/publicLinks.ts`

Permanently deleting a file removes its blobs and File doc but not associated `Share` or
`PublicLink` records. Combined with I1 this leaves orphaned links/shares; a recreated file
reusing an id is implausible (ObjectIds), but the rows accumulate.
**Fix:** Cascade-delete `Share` and `PublicLink` by `fileId` in `purge`.

### M3. `storageUsedBytes` accounting can drift / go negative
**Files:** `backend/src/storage/storageService.ts:98-99,116-118,190-192`, `clusterManager.ts:71-74`

Upload `$inc`s by chunk length; delete `$inc`s by `-blob.size`; the scheduler `runStorageCheck`
overwrites the field with real `dbStats`. The `$inc` path counts encrypted/overhead bytes
while `size` semantics elsewhere are plaintext, and concurrent rollback best-effort decrements
can race. Not corrupting, but the number shown to users (and the pre-warm gate between
dbStats sweeps) can be inaccurate or briefly negative. Acceptable for v1; note for hardening.

### M4. Global error handler leaks internal error messages
**File:** `backend/src/app.ts:72-74`

The catch-all returns `err.message` verbatim with 500. Mongo/Atlas/driver errors can expose
internal details (hostnames, stack-ish text). Low impact behind OAuth, but prefer a generic
message + server-side log in production.

### M5. CORS allows requests with no `Origin` header
**File:** `backend/src/app.ts:27-34`

`if (!origin || allowedOrigins.includes(origin))` permits no-origin requests (curl/Postman/
server-to-server). Intentional per the comment and combined with cookie+OAuth auth it's not
an auth bypass, but worth noting since `credentials: true` is set.

### M6. `express.json({ limit: '10mb' })` vs multipart uploads
**File:** `backend/src/app.ts:39`

Uploads use multer/memoryStorage (not the JSON body parser), so the 10mb JSON limit doesn't
cap file size — there is **no explicit upload size limit**, and files are buffered fully in
memory (`multer.memoryStorage()`) then encrypted in one pass. On a Pi with limited RAM a few
concurrent large uploads can OOM. Consider a multer `limits.fileSize` and/or streaming.

---

## Verified GOOD (no action)

- **SHARD_E2E login is genuinely inert when unset**: mount guard (`app.ts:56`) *and*
  request-time guard (`e2eAuth.ts:40-43`) both check `=== '1'`. Safe.
- **File/share/public-link authorization is enforced**: `canAccess` (owner OR direct/
  ancestor-folder share) gates download/patch/delete; share & public-link create/delete/list
  are strictly owner/creator-checked; user A cannot read/share/delete user B's files.
- **Public-link download is scoped to the single linked file and expiry-checked** (expiry ok;
  only the deleted-state gap in I1 remains).
- **GridFS split/reassembly mechanics** (ordered blob `index`, per-cluster bucket) are
  correct; only the provisioning gate (I4) is wrong.
- **No leftover stubs/TODOs/placeholder logic in shipped code** (only UI input placeholders).
- **nginx** correctly serves the built SPA with `try_files` fallback and proxies `/api/` to
  `backend:4000`; storage loops start only when `NODE_ENV !== 'test'`.
- **Crypto** (AES-256-GCM, per-file random salt+iv, PBKDF2, auth tag) is sound.
- Base images (`node:20-alpine`, `nginx:alpine`) are multi-arch → fine on arm64.

---

## Fix Report — 2026-06-22

Commit range: `87d34f1..d3ef431` (9 commits on `main`)

**Suite results (post-fix):**
- Backend: **316 / 316** Jest tests pass (310 original + 6 new)
- Frontend: **84 / 84** Vitest tests pass
- E2E: **8 / 8** Playwright tests pass
- `tsc --noEmit`: 0 errors (backend + frontend)

---

### C1 — FIXED (`a0ed865`)
**File:** `backend/src/index.ts`, `backend/src/storage/clusterManager.ts`, `backend/src/storage/storageService.ts`

Two-layer fix:
1. `index.ts`: after DB connect, `rehydrateStorageClusters()` loads all non-decommissioned `StorageCluster` docs and calls `openCluster()` for each (per-cluster failures are logged, non-fatal — lazy reconnect covers them).
2. `clusterManager.ts`: new `getOrOpenBucket(clusterId)` — if the connection is missing, looks up the `StorageCluster` doc and opens on demand before returning the bucket.
3. `storageService.ts`: all `getBucket()` calls replaced with `getOrOpenBucket()` so reads, writes, deletes and rollbacks all benefit from lazy reconnection.

Test: existing multi-cluster E2E flows (upload/read/delete) exercise the code paths; no regression.

### C2 — FIXED (`87d34f1`)
**File:** `backend/Dockerfile`

Builder stage changed from `npm ci --only=production` → `npm ci` (full install including devDeps/tsc). Runtime stage uses `npm ci --omit=dev` (modern flag; `--only=production` is deprecated). Build now succeeds and runtime image is still lean.

### C3 — FIXED (`78923ae`)
**Files:** `backend/src/routes/setup.ts`, `docker-compose.yml`, `.env.example`

- `setup.ts`: default `SETUP_ENV_FILE_PATH` changed from the broken `path.join(cwd, '..', '.env')` (= `/`) to `path.join(cwd, 'config', '.env')` (= `/app/config/.env`), writable by the `shard` user.
- `docker-compose.yml`: added `./config:/app/config` volume mount so the written file persists on the host; `SETUP_ENV_FILE_PATH` set to `/app/config/.env`.
- `.env.example`: documents `COOKIE_SECURE` and `SETUP_ENV_FILE_PATH`.
- Passport re-init after configure wired in same commit (see I3).
- Bootstrap requirement documented inline in `docker-compose.yml`: operator must create `.env` from `.env.example` before first `docker compose up`.

### I1 — FIXED (`906ed29`)
**Files:** `backend/src/services/publicLinks.ts`, `backend/src/routes/files.ts`, `backend/src/routes/v1.ts`

- `resolveSlug()`: added `file.deletedAt != null → throw NOT_FOUND` check, propagating as 404 from both the metadata and download public endpoints.
- `GET /api/files/:id/download` and `GET /api/v1/files/:id/download`: reject with 404 before access-control check when `deletedAt` is set.
- **Tests added:** `publicLinks.test.ts` — slug metadata + download return 404 for trashed file; `files.test.ts` — auth download returns 404 for trashed file.

### I2 — FIXED (`9814c78`)
**File:** `backend/src/routes/auth.ts`

Replaced `secure: process.env.NODE_ENV === 'production'` with a helper `isCookieSecure()` that reads `COOKIE_SECURE` env var (`true`/`1` → secure, else false, default false). Applied consistently to both the login `res.cookie()` and the `clearCookie()` on logout. Documented in `.env.example`.

### I3 — FIXED (`c3a0143`, `78923ae`)
**Files:** `backend/src/auth/passport.ts`, `backend/src/routes/setup.ts`

- `configurePassport()`: calls `passport.unuse('google')` / `passport.unuse('github')` before re-registering, making the function safe to invoke multiple times.
- `setup.ts` `POST /configure`: calls `configurePassport()` after writing env so OAuth strategies are live immediately without a restart.

### I4 — FIXED (`588d121`)
**File:** `backend/src/storage/storageService.ts`

Changed `ensureCapacity(userId, payload.length - offset)` → `ensureCapacity(userId, 1)`. The active cluster is now returned whenever it has any free space (`free >= 1`), and the existing `chunkSize = Math.min(free, remaining)` correctly fills the partial remainder. A new cluster is only provisioned when the active one is genuinely full.

**Test added:** `storageService.test.ts` — `I4 — spill fills partially-used cluster` verifies a 200-byte file against a 100-byte-free cluster produces exactly 2 blobs (100 on cluster1, 100 on cluster2) and that `ensureCapacity` is called with `neededBytes=1`.

### I5 — FIXED (`b42cb76`)
**File:** `backend/src/atlas/client.ts`

`waitForCluster()` now accepts `timeoutMs` (default: `ATLAS_PROVISION_TIMEOUT_MS` env var or 15 min). When `Date.now() >= deadline`, throws `{ code: 'CLUSTER_PROVISION_TIMEOUT' }`. Added `timeoutMs` to `AtlasClient` interface.

**Tests added:** `client.test.ts` — returns cluster on IDLE; throws `CLUSTER_PROVISION_TIMEOUT` when deadline exceeded (1ms poll, 50ms timeout).

---

### Minor findings

| Finding | Status | Notes |
|---------|--------|-------|
| M1 — dual mongoose connection | Deferred | Intentional by design (comment in index.ts); both connections point to the same URI in production — no risk. Risky to collapse without end-to-end testing of every model resolution path. |
| M2 — dangling Share + PublicLink on purge | **FIXED** (`d3ef431`) | `purge()` now cascade-deletes `Share` and `PublicLink` docs by `fileId` (and all descendant fileIds for folder purges). |
| M3 — storageUsedBytes drift | Deferred | Acceptable for v1 per the original review; scheduler `dbStats` sweeps correct the value. Fixing requires reworking all increment paths — scope too large for this pass. |
| M4 — global error handler leaks internal messages | **FIXED** (`d3ef431`) | `app.ts` error handler logs full error server-side and returns `"Internal server error"` in production. Dev mode returns the real message. |
| M5 — CORS allows no-Origin requests | Deferred | Intentional per in-code comment; combined with cookie+OAuth auth it's not an auth bypass. Low risk — skipped. |
| M6 — no multer upload size limit | Deferred | Requires streaming architecture change to fix properly; multer `limits.fileSize` alone doesn't prevent OOM for concurrent uploads. Out of scope for this pass. |

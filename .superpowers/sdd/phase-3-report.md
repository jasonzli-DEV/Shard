# Phase 3 Implementation Report — Atlas Client + Cluster Manager + Autoscaler

**Date:** 2026-06-22
**Commits:** abd8569..d2c546d
**Tests:** 100 passed, 0 failed (`npm test --forceExit`)
**TypeScript:** `npx tsc --noEmit` — clean

---

## Tasks Completed

### Task 3.1 — `backend/src/atlas/client.ts`

**Port of** `/Users/zhixiangli/Github/Aura/src/db/atlas.js` to TypeScript strict.

`makeAtlasClient({publicKey, privateKey})` returns:
- `apiGet / apiPost / apiPatch` — digest-auth fetch wrappers (RFC 2617: MD5 HA1/HA2/response, nc/cnonce/qop)
- `discoverOrgId()` — queries `/orgs`, returns first org ID
- `createProject(orgId, name)` — POST `/groups`
- `createCluster(projectId, clusterName)` — M0/TENANT/AWS/US_EAST_1/REPLICASET per Global Constraints
- `waitForCluster(projectId, clusterName, pollMs=15000)` — polls until `stateName === 'IDLE'`
- `createDatabaseUser(projectId, username, password)` — atlasAdmin role
- `addIpAllowlist(projectId)` — 0.0.0.0/0 CIDR
- `buildConnectionUri(srvHost, user, pass, db='shard')` — URL-encodes credentials
- `parseCredentialsFromUri(uri)` — decodes URI credentials
- `addOrgApiKeyAccessList(orgId, ipAddress)` — POST to org apiKey access list (uses publicKey as keyId)
- `withOrgApiAccessListRetry(orgId, operation)` — catches ORG_REQUIRES_ACCESS_LIST 403, adds IP, retries
- `extractRequiredAccessListIp(err)` — extracts IP from 403 ORG_REQUIRES_ACCESS_LIST error body

**Constants:** base `https://cloud.mongodb.com/api/atlas/v2`, Accept `application/vnd.atlas.2023-02-01+json`.

**Tests (16 green):** digest challenge parse (realm/nonce/qop/opaque captured in Authorization header), Accept header, base URL, `buildConnectionUri` happy path + URL encoding + default db, `extractRequiredAccessListIp` all edge cases (wrong errorCode, wrong status, malformed JSON, null), `parseCredentialsFromUri` roundtrip + URL decode, `createCluster` body shape (M0/TENANT/AWS/US_EAST_1), `withOrgApiAccessListRetry` retries on access list error / does not retry on other errors.

---

### Task 3.2 — `backend/src/storage/clusterManager.ts`

Per-user cluster manager. Connections keyed by `clusterId` string.

- `openCluster(entry)` — `mongoose.createConnection(uri)`, deduplicates by clusterId
- `getBucket(clusterId)` — returns cached `GridFSBucket` (bucket name `shard-files`), accesses `mongoose.mongo.GridFSBucket` dynamically so tests can spy
- `getActiveCluster(userId)` — queries `StorageClusterModel.findOne({ userId, status: 'active' })`
- `runStorageCheck(userId)` — `dbStats` command → `dataSize + indexSize`, persists `storageUsedBytes` + `lastCheckedAt`, returns `{ checked, clusterId, usedBytes, atThreshold }` where `atThreshold = usedBytes >= capacity * 0.80`
- `keepalive()` — ping all open connections
- `closeAll()` — closes all connections, clears connection + bucket caches

**Deviations from Aura:** no global `activeArchiveClusterId`; `getActiveCluster` always queries DB by `userId` + `status:'active'`. `runStorageCheck(userId)` takes a userId parameter (per-user fleet).

**Tests (13 green):** openCluster dedup, getBucket returns bucket + returns null for unknown + caches, getActiveCluster returns active / returns null, runStorageCheck below threshold / at threshold / no active cluster / persists storageUsedBytes, keepalive calls ping, closeAll closes and clears.

---

### Task 3.3 — `backend/src/storage/provisioner.ts`

- `provisionNextCluster(userId)`:
  1. Finds all user's `OrgKey` docs
  2. Selects first with `clusterCount < 250`
  3. Throws `StorageFullError` (`.code = 'STORAGE_FULL'`) if none available
  4. `makeAtlasClient(orgKey)` → `withOrgApiAccessListRetry` → `createProject` → `createCluster` → `waitForCluster`
  5. Generates `dbUser = shard-<nanoid(12)>` + `dbPass = nanoid(32)`
  6. `createDatabaseUser` + `addIpAllowlist` + `buildConnectionUri`
  7. Demotes prior active clusters to `status: 'full'` (non-fatal)
  8. `StorageClusterModel.create(...)` with `status: 'active'`
  9. `OrgKeyModel.findByIdAndUpdate($inc clusterCount: 1)`
  10. `openCluster(...)` best-effort

- `ensureCapacity(userId, neededBytes)` → returns active cluster when `storageCapacityBytes - storageUsedBytes >= neededBytes`, otherwise calls `provisionNextCluster`.

**Tests (9 green):** happy path (createProject/createCluster/waitForCluster/createDatabaseUser/addIpAllowlist/create called, OrgKey incremented), demotes prior active, org rollover (clusterCount=250 → uses next OrgKey), STORAGE_FULL on all orgs at cap, STORAGE_FULL when no orgs, ensureCapacity returns existing cluster with room, provisions when no active, provisions when insufficient space, returns without provisioning when plenty of space.

---

### Task 3.4 — `backend/src/storage/scheduler.ts` + `backend/src/index.ts`

- `startStorageLoops()` — sets two `setInterval` handles:
  - **Keepalive:** every 60,000ms → `keepalive()`
  - **Storage check:** every 600,000ms → queries all active clusters grouped by userId, calls `runStorageCheck(userId)`, provisions if `atThreshold`
- `stopStorageLoops()` — clears both intervals (idempotent)
- `index.ts` — calls `startStorageLoops()` guarded by `process.env.NODE_ENV !== 'test'`

**Tests (6 green):** keepalive fires every 60s + fires again at 120s, storage check fires every 10min, provisions on threshold, does not provision below threshold, does not throw on keepalive failure, stopStorageLoops prevents callbacks.

---

## Architecture Notes

- No `isActive` boolean used anywhere — status enum `'active'|'full'|'error'|'decommissioned'|'provisioning'` per model spec
- `StorageCluster.clusterId` is the Atlas cluster name (string), used as the Map key in clusterManager
- Org rollover: `clusterCount < 250` selects the first available org key in order of OrgKey.find() results
- `runStorageCheck` in scheduler iterates `StorageClusterModel.find({ status: 'active' })` to get all users' active clusters, deduplicates userIds, then runs per-user check
- All Atlas keys stored plaintext per Global Constraints; no encryption added
- `withOrgApiAccessListRetry` uses the `publicKey` as the Atlas API key ID for the access list entry (matches Aura behavior)

## Blocking Concerns

None. All tests green, TypeScript clean.

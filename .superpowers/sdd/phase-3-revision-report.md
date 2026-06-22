# Phase 3 Revision Report

**Date:** 2026-06-22  
**Commits:** 3eb00b9..4ffebb9  
**Tests:** 119 passed, 0 failed (14 suites)  
**TypeScript:** clean (`npx tsc --noEmit`)

---

## Changes Made

### 1. Pack clusters to USABLE_BYTES (commit 3eb00b9)

**Files:** `backend/src/storage/clusterManager.ts`, `backend/src/storage/provisioner.ts`

- Introduced exported constants: `STORAGE_LIMIT_BYTES = 512MB`, `SAFETY_MARGIN_BYTES = 20MB`, `USABLE_BYTES = 492MB`
- `PREWARM_THRESHOLD = 0.90` — used only in `runStorageCheck` background path
- `ensureCapacity` now computes `free = USABLE_BYTES - storageUsedBytes` instead of `storageCapacityBytes * 0.80`
- The 80% gate is fully removed from the synchronous upload path
- Tests updated: old "80% threshold" tests replaced with PREWARM_THRESHOLD (90% of USABLE) tests; added a "82% of LIMIT is still below pre-warm" test to verify packing behavior

### 2. Configurable Atlas region (commit 739b9d2)

**Files:** `backend/src/atlas/client.ts`, `backend/src/models/OrgKey.ts`, `backend/src/storage/provisioner.ts`, `.env.example`

- `M0_ELIGIBLE_REGIONS` constant + `M0Region` type exported from atlas client
- `createCluster(projectId, clusterName, region = 'US_EAST_1')` — region parameter, no longer hardcoded
- `deleteCluster(projectId, clusterName)` and `deleteProject(projectId)` added to `AtlasClient` interface and implementation
- `OrgKey.region` optional string field added to schema and interface
- `provisionNextCluster` resolves region: `orgKey.region ?? process.env.ATLAS_DEFAULT_REGION ?? 'US_EAST_1'` (read dynamically so env changes are testable)
- Throws descriptive error on invalid region before Atlas call
- `.env.example` documents `ATLAS_DEFAULT_REGION` with valid values

### 3. Downscaling — decommissionEmptyClusters (commit 4ffebb9)

**Files:** `backend/src/storage/clusterManager.ts`, `backend/src/storage/decommission.ts` (new), `backend/src/storage/scheduler.ts`

- `closeCluster(clusterId)` added to clusterManager for per-cluster teardown
- `decommissionEmptyClusters(userId)`: finds all user's clusters, skips active ones, skips any with Blobs (`BlobModel.exists`), skips if only one cluster remains, calls `deleteCluster + deleteProject` on Atlas, decrements `OrgKey.clusterCount`, deletes `StorageCluster` record, closes connection
- Scheduler: new `EMPTY_SWEEP_MS = 30 * 60_000` interval, `emptySweepInterval` tracked alongside existing intervals, `stopStorageLoops` clears it
- All Atlas calls mocked in tests — no real Atlas calls

## Test Summary

| Suite | Tests |
|---|---|
| atlas/client | 19 |
| storage/clusterManager | 17 |
| storage/provisioner | 17 |
| storage/scheduler | 8 |
| storage/decommission | 5 |
| other (auth, models, routes) | 53 |
| **Total** | **119** |

## Blocking Concerns

None.

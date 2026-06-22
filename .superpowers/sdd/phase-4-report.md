# Phase 4 Report — Storage Service (GridFS)

## Status: COMPLETE

## Commits
- `241864b` feat(phase-4): Task 4.1 — crypto utils
- `42c8c1c` feat(phase-4): Task 4.2 — storageService + paths

## Test Summary
144 tests passing, 17 suites, 0 failures. `npx tsc --noEmit` clean.

### New tests added
- `src/utils/__tests__/crypto.test.ts` — 8 tests: roundtrip, 44-byte overhead, empty/large buffer, non-deterministic, wrong-key throws
- `src/utils/__tests__/paths.test.ts` — 6 tests: no-collision passthrough, (1) dedupe, counter increment, subfolder scope, no-extension files, user isolation
- `src/storage/__tests__/storageService.test.ts` — 11 tests: single-cluster store→read, encrypted store→read, name dedupe, multi-cluster split, storageUsedBytes update, multi-cluster reassembly, file-not-found error, delete removes blobs + decrements usage, idempotent delete

## Files Created
- `backend/src/utils/crypto.ts` — `encryptBuffer`, `decryptBuffer`, `generateEncryptionKey`; AES-256-GCM, PBKDF2 key derivation, salt(16)+iv(12)+tag(16)+ciphertext layout
- `backend/src/utils/paths.ts` — `getUniqueName`, `buildPath`
- `backend/src/storage/storageService.ts` — `storeFile`, `readFile`, `deleteFileBytes`

## Key Implementation Notes
- `storeFile` splits payload across clusters by filling current cluster's remaining `USABLE_BYTES` first, then calling `ensureCapacity` for the next cluster
- Encryption is whole-file before splitting (single encrypt call, then split encrypted bytes)
- `getBucket` mock injection via `jest.mock('../clusterManager')` + `jest.mock('./provisioner')` in tests; real GridFS I/O against `mongodb-memory-server` instances
- Type conflict between `mongoose`'s bundled `mongodb` and root `mongodb` package resolved by using `mongoose.mongo.GridFSBucket` in tests

## Blocking Concerns
None.

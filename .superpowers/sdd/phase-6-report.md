# Phase 6 Implementation Report — Sharing + Public Links

**Date:** 2026-06-22  
**Commits:** c713d04..0aba65a  
**Test result:** 280 passed, 0 failed (35 new tests added)  
**TypeScript:** `npx tsc --noEmit` — clean

---

## Task 6.1 — Shares

### New files
- `backend/src/services/shares.ts` — `canAccess`, `shareFile`, `unshareFile`, `listFileShares`, `listSharedWithMe`
- `backend/src/routes/shares.ts` — POST/DELETE `/api/files/:id/share`, GET `/api/files/:id/shares`, GET `/api/shared-with-me`
- `backend/src/routes/__tests__/shares.test.ts` — 19 tests

### canAccess logic
1. Owner → always granted
2. Direct Share document on fileId granting user ≥ needed permission
3. Ancestor folder share: walks all path segments of `file.path`, finds folder docs owned by the file owner at those paths, checks for a Share on any of them

### files.ts integration
- Download (`GET /api/files/:id/download`): `canAccess(userId, id, 'view')` replaces raw ownership check
- PATCH + DELETE: file existence checked first (→ 404), then `canAccess(userId, id, 'edit')` (→ 403), then service call uses file owner's userId so shared users can operate without owning the file

---

## Task 6.2 — Public Links

### New files
- `backend/src/utils/slug.ts` — `generateUniqueSlug()`: adjective-noun-number format (e.g. `swift-tide-4821`); uniqueness-checked against PublicLink.slug with fallback timestamp suffix
- `backend/src/services/publicLinks.ts` — `createPublicLink`, `listUserPublicLinks`, `deletePublicLink`, `resolveSlug`, `incrementDownloadCount`
- `backend/src/routes/publicLinks.ts` — authenticated + public (no-auth) endpoints
- `backend/src/routes/__tests__/publicLinks.test.ts` — 16 tests

### Public link model notes
Existing `PublicLink` model uses `createdBy` (not `userId` per plan spec). Service adapted to match actual schema. `expiresAt` TTL index is already set on the model.

### app.ts mount order
`publicLinksRouter` is mounted **before** `filesRouter` to prevent `filesRouter`'s global `requireAuth` middleware from intercepting unauthenticated requests to `/api/public/:slug`.

### Expiry enforcement
`resolveSlug` throws `EXPIRED` (→ 410) when `link.expiresAt < new Date()`. Both metadata and download endpoints enforce this.

---

## Blocking concerns
None.

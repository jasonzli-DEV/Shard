# Phase 2 Auth — Implementation Report

**Date:** 2026-06-22
**Branch:** main
**Commit range:** 30f8a7f..7d56769

## Status: DONE

## What Was Built

### Task 2.1 — JWT + Session Utils
- `backend/src/auth/jwt.ts`: `signJwt(userId)` / `verifyJwt(token)` using `jsonwebtoken`, 7-day TTL
- `backend/src/auth/sessions.ts`: `createSession(userId)` (signs JWT, persists Session doc), `getSessionUser(token)` (validates token and expiry), `setSessionConnection()` for test injection

### Task 2.2 — OAuth + First-User-Admin + Middleware + Auth Routes
- `backend/src/auth/passport.ts`: `upsertUserFromProfile()` (create/update user from OAuth profile; first user ever → role `admin`; subsequent → role `user`), `configurePassport()` (registers Google + GitHub Passport strategies), `setPassportConnection()` for test injection
- `backend/src/middleware/auth.ts`: `requireAuth` — accepts httpOnly cookie `shard_token` (JWT session) OR `Authorization: Bearer shard_<key>` (API key); API key path updates `lastUsed`; `setAuthMiddlewareConnection()` for test injection
- `backend/src/routes/auth.ts`:
  - `GET /api/auth/:provider` — passport redirect (Google/GitHub); 400 for unsupported
  - `GET /api/auth/:provider/callback` — passport callback; sets httpOnly JWT cookie; redirects to `FRONTEND_URL`
  - `POST /api/auth/logout` — clears `shard_token` cookie
  - `GET /api/me` — returns authenticated user (mounted at `/api/me` in app.ts via exported `meHandler`)

### Task 2.3 — API Keys
- `backend/src/routes/apiKeys.ts`:
  - `GET /api/keys` — list user's keys (keyHint only, never full key)
  - `POST /api/keys` — create key (`shard_` + nanoid(40)); full key returned only at creation
  - `DELETE /api/keys/:id` — scoped to user (can't delete others' keys)

### App wiring
- `backend/src/app.ts` updated to initialize passport, mount `/api/auth`, `/api/me`, `/api/keys`

## TDD Cycle Applied

Every function had a failing test before implementation:
1. Write test → confirm fail (module not found or assertion fail)
2. Implement minimal code
3. Confirm pass
4. Commit

## Test Results

```
Test Suites: 9 passed, 9 total
Tests:       56 passed, 56 total
TypeScript:  No errors (npx tsc --noEmit clean)
```

New tests added in Phase 2:
- `src/auth/__tests__/jwt.test.ts` — 3 tests
- `src/auth/__tests__/sessions.test.ts` — 4 tests
- `src/auth/__tests__/passport.test.ts` — 5 tests
- `src/middleware/__tests__/auth.test.ts` — 6 tests
- `src/routes/__tests__/auth.test.ts` — 7 tests
- `src/routes/__tests__/apiKeys.test.ts` — 10 tests

## Key Design Decisions

- **Test injection pattern**: Each module exports a `set*Connection()` function so tests can bind models to the in-memory MMS connection without needing a live starter DB. This mirrors the `bound()` helper used in Phase 1 model tests.
- **`/api/me` placement**: The spec calls for `GET /api/me` (not `/api/auth/me`). Since the auth router is mounted at `/api/auth`, `meHandler` is exported and separately mounted at `/api/me` in app.ts to avoid route param collision.
- **First-user-admin**: `upsertUserFromProfile` counts existing users at creation time; if count is 0, sets `role: 'admin'`.
- **API key format**: `shard_` + `customAlphabet(62-char set, 40)` = 46-char total.
- **Security**: Cookie is `httpOnly`, `sameSite: lax`, `secure` in production; full API key only returned once at POST /api/keys creation.

## Files Changed/Created

```
backend/src/auth/jwt.ts
backend/src/auth/sessions.ts
backend/src/auth/passport.ts
backend/src/middleware/auth.ts
backend/src/routes/auth.ts
backend/src/routes/apiKeys.ts
backend/src/app.ts  (updated)
backend/src/auth/__tests__/jwt.test.ts
backend/src/auth/__tests__/sessions.test.ts
backend/src/auth/__tests__/passport.test.ts
backend/src/middleware/__tests__/auth.test.ts
backend/src/routes/__tests__/auth.test.ts
backend/src/routes/__tests__/apiKeys.test.ts
```

# Shard v2 C/D/B — Implementation Report

## Commit range
`b6f8c6c` (backend) → `529ed2f` (frontend+vercel)

## Suite results
- **backend**: 367 tests, 29 suites — all passed
- **frontend**: 86 tests, 11 suites — all passed
- **frontend build**: clean (`npx tsc --noEmit` + `npm run build`)
- **E2E (Playwright)**: 8 tests — all passed

---

## API Contract Changes

### `GET /api/me`
```json
{
  "id": "string",
  "email": "string",
  "name": "string",
  "displayName": "string",
  "avatarUrl": "string | null",
  "role": "admin | user",
  "status": "active | pending",
  "encryptionEnabled": "boolean",
  "provider": "google | github"
}
```
**Change**: now accessible for `pending` users (returns their status so frontend can show the pending screen). Pending users get 403 `{error:'pending_approval'}` on all other protected routes.

---

### `GET /api/admin/users` (admin only)
```json
[{ "id", "email", "name", "provider", "role", "status", "createdAt" }]
```

### `POST /api/admin/users/:id/approve` (admin only)
Sets `status='active'`. Returns `{ id, status }`.

### `POST /api/admin/users/:id/deny` (admin only)
Deletes the user. Cannot deny yourself or the last admin. Returns `{ message }`.

### `POST /api/admin/users/:id/role` (admin only)
Body: `{ role: 'admin' | 'user' }`. Cannot demote self or last admin.

### `GET /api/admin/access-mode` (admin only)
Returns `{ accessMode: 'open' | 'approval' }`.

### `PUT /api/admin/access-mode` (admin only)
Body: `{ accessMode: 'open' | 'approval' }`. Persisted to Config DB.

### `GET /api/admin/invites` (admin only)
Returns `[{ id, email, createdBy, createdAt }]`.

### `POST /api/admin/invites` (admin only)
Body: `{ email }`. Creates invite — invited email gets `status='active'` on first sign-in (invite consumed).

### `DELETE /api/admin/invites/:id` (admin only)
Deletes invite.

---

### `POST /api/cron/storage-check`
Auth: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
- 401 if secret wrong, 204 if `CRON_SECRET` not configured.
- Calls `runStorageCheckAllUsers()`.

### `POST /api/cron/decommission`
Same auth. Calls `runDecommissionSweep()`.

---

### `GET /api/setup/status` — changed
```json
{
  "setupRequired": "boolean",
  "configured": { "starterDb", "jwt", "google", "github", "publicUrl" },
  "starterFromEnv": "boolean"   // NEW: true when STARTER_MONGODB_URI is in env
}
```
When `starterFromEnv=true`, the setup wizard skips step 1 (starter cluster URI).

### `POST /api/setup/configure` — changed
`starterUri` is now optional in the body; if `STARTER_MONGODB_URI` is already in env it is used directly.

---

### `GET /api/storage` — changed
```json
{
  "orgs": [...],
  "totalUsedBytes": "number",
  "totalCapacityBytes": "number",
  "usedPercent": "number",
  "starter": {           // NEW admin-facing field
    "usedBytes": "number",
    "capacityBytes": "number",
    "usedPercent": "number",
    "nearCapacity": "boolean"   // true when ≥80% of STARTER_CAPACITY_BYTES (default 512MB)
  }
}
```

---

## vercel.json Layout

```json
{
  "buildCommand": "cd frontend && npm run build",
  "outputDirectory": "frontend/dist",
  "env": { "SERVERLESS": "1" },
  "functions": { "api/index.ts": { "includeFiles": "backend/src/**" } },
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.ts" },
    { "src": "/(.*)", "dest": "/frontend/dist/$1" }
  ],
  "crons": [
    { "path": "/api/cron/storage-check", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/decommission", "schedule": "*/5 * * * *" }
  ]
}
```

---

## Environment Variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `STARTER_MONGODB_URI` | **Yes** | — | Only required env var |
| `CRON_SECRET` | Optional | — | Enables cron endpoints; if unset, endpoints return 204 |
| `SERVERLESS` | Set by Vercel | `'1'` | Gates background loops off in serverless |
| `STARTER_CAPACITY_BYTES` | Optional | `536870912` (512MB) | Warn threshold baseline |
| `COOKIE_SECURE` | Optional | `false` | Set `true` for HTTPS deployments |
| `PORT` | Optional | `4000` | Docker/Pi only |

All other config (OAuth creds, publicUrl, allowedOrigins, jwtSecret) lives in the starter DB and is managed via the setup wizard + admin UI.

---

## Access Control Logic

- **First user ever** → `role: 'admin', status: 'active'`
- **Subsequent new users**:
  - If invited (email in Invite collection) → `status: 'active'`, invite consumed
  - If `accessMode === 'open'` → `status: 'active'`
  - Otherwise → `status: 'pending'`
- Pending users: `/api/me` and `/api/auth/logout` bypass pending check; all other protected routes return 403 `{error:'pending_approval'}`
- E2E test users are always forced to `status: 'active'`

---

## Graceful 507 Handling (Workstream D)

`utils/starterErrors.ts` classifies Mongo quota/space/connection errors and maps them to HTTP 507 with message: `"Metadata store is full or unreachable — upgrade the starter cluster"`. Applied to:
- `POST /api/files` (upload)
- `POST /api/folders`
- Process-level `unhandledRejection`/`uncaughtException` guards log but do not crash.

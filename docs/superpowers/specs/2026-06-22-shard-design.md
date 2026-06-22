# Shard — Design Spec

**Date:** 2026-06-22
**Status:** Approved design, pre-implementation
**One-liner:** Free, self-hostable cloud storage that grows itself — files live in GridFS spread across a fleet of free MongoDB Atlas M0 clusters (512 MB each). Add your Atlas org keys and Shard auto-provisions new clusters as you fill up (~125 GB per org, unlimited orgs).

Shard is a fork of **D-Drive** (Discord-backed storage) re-architected to use **MongoDB Atlas** as the storage substrate, modeled on the **Aura** Discord bot's Atlas autoscaling system.

---

## 1. Goals & non-goals

### Goals
- Google-Drive-like web app for storing/organizing files, self-hosted.
- All persistence on **MongoDB** (no Postgres). File **bytes** in GridFS; **metadata** in a starter cluster.
- **Per-user** storage: each user supplies their own Atlas **org API keys** (multiple per user). Storage autoscales inside their orgs.
- A documented **REST API** with API-key auth so the product is automatable.
- A **setup wizard** that feels hand-built and branded — explicitly *not* a generic AI-templated card.
- Distinct **"Shard"** brand identity.
- Ship **fully finished**: production-ready, fully tested (unit + integration + E2E), deployed to `pi.local` replacing D-Drive.

### Non-goals (this version)
- CLI tool (the REST API is designed to support one later, but no CLI ships now).
- SFTP scheduled-backup tasks (D-Drive feature; deferred unless trivial).
- Serverless (Vercel) deployment. Config stays env-driven and minimal so it *could* be hosted simply, but the long-lived autoscaler/keepalive requires a persistent host; deploy target is Docker on `pi.local`.

---

## 2. Architecture

```
┌────────────┐     ┌───────────────┐     ┌──── Starter cluster (operator) ─────┐
│  Frontend  │────▶│   Backend     │────▶│ accounts · file tree · cluster      │
│ React+Vite │     │ Node/Express  │     │ registry · api keys · sessions ·    │
│    + TS     │     │     + TS      │     │ shares · public links               │
└────────────┘     │               │     └─────────────────────────────────────┘
                   │  Autoscaler   │     ┌──── Per-user fleet (their orgs) ────┐
                   │  + Atlas API  │────▶│ M0 #1  M0 #2  M0 #3 ...  (GridFS)     │
                   └───────────────┘     │ auto-provisioned at 80% full          │
                                         └───────────────────────────────────────┘
```

- **All-MongoDB.** The operator provides ONE **starter cluster** connection URI at setup (a free M0 made manually). It stores metadata only.
- **File bytes** live in **GridFS** on a per-user fleet of M0 clusters in the user's own Atlas org(s).
- **Stack:** React + Vite + TypeScript (frontend); Node/Express + TypeScript (backend); **Mongoose** ODM; reuse of Aura's digest-auth Atlas client + connection-manager pattern; Docker Compose deploy.

### Component boundaries (each independently testable)
- `atlas-client` — Atlas Admin API v2 over HTTP digest auth (create project/cluster, wait-for-IDLE, db user, IP allowlist, build URI). Ported from Aura `src/db/atlas.js`.
- `cluster-manager` — opens/caches per-cluster connections + GridFS buckets, runs storage checks, triggers provisioning, keepalive. Ported from Aura `src/db/connection.js`. **Keyed by `(userId, clusterId)`** instead of a single global fleet.
- `storage-service` — high-level put/get/delete of files: routes bytes to a cluster with free space, splits across clusters, records Blob metadata.
- `metadata` — Mongoose models on the starter cluster.
- `auth` — OAuth (Google/GitHub), sessions, API-key verification.
- `routes/*` — Express REST endpoints (web session + API key).
- `frontend` — Drive UI, dashboard, settings, setup wizard.

---

## 3. Data model (starter cluster, Mongoose)

- **User**: `{ _id, provider, providerId, email, displayName, avatarUrl, role: 'admin'|'user', encryptionKey?, encryptByDefault, recycleBinEnabled, theme, timezone?, createdAt }`. First user created becomes `admin`.
- **OrgKey** (per user, multiple): `{ _id, userId, label, atlasPublicKey, atlasPrivateKey, atlasOrgId, createdAt }`. Stored **plaintext** (intentional — starter-DB access already implies full trust; keeps setup simple).
- **StorageCluster** (registry): `{ _id, userId, orgKeyId, atlasProjectId, atlasClusterName, clusterId, connectionUri, isActive, storageUsedBytes, capacityBytes(=512MB), lastCheckedAt, provisionedAt }`. Plaintext `connectionUri`.
- **File** (tree node): `{ _id, userId, name, path, parentId?, type: 'file'|'directory', size, mimeType, encrypted, starred, deletedAt?, originalPath?, deletedWithParentId?, createdAt, updatedAt }`. Unique `(userId, path)`.
- **Blob** (byte location; a File has 1..n): `{ _id, fileId, index, clusterId, gridFsId, size, createdAt }`. Unique `(fileId, index)`.
- **ApiKey**: `{ _id, userId, key(unique), name, lastUsed?, createdAt }`.
- **Session**: `{ _id, userId, token(unique), expiresAt, createdAt }`.
- **Share**: `{ _id, fileId, ownerId, sharedWithId, permission: 'view'|'edit', createdAt }`. Unique `(fileId, sharedWithId)`.
- **PublicLink**: `{ _id, slug(unique), fileId, userId, expiresAt?, createdAt }`.

---

## 4. Storage flow

### Upload
1. Resolve parent path, dedupe name (D-Drive's `getUniqueName` logic).
2. Pick the user's **active** cluster with free space. If the file (optionally encrypted; AES-256-GCM, 44-byte overhead per part like D-Drive) exceeds remaining space, split: fill current cluster, continue onto next (provision if none available).
3. Stream each part into that cluster's **GridFS bucket**; record a `Blob`.
4. Write the `File` metadata with total size.

### Download
- Look up `Blob`s ordered by `index`, stream each from its cluster's GridFS bucket, concatenate (decrypt if needed).

### Delete
- Delete GridFS objects per Blob, then File/Blob metadata. Recycle bin: soft-delete via `deletedAt` when enabled; purge on empty.

---

## 5. Autoscaler (ported from Aura, made per-user)

- Constants: `STORAGE_LIMIT = 512MB`, `THRESHOLD = 0.80`, `WARN = 0.75`, `STORAGE_CHECK = 10min`, `KEEPALIVE = 60s`.
- Every interval: for each user's active cluster, run `dbStats`, compute `dataSize + indexSize`, persist `storageUsedBytes`. At ≥80%, **provision the next M0** in that user's current org:
  - `createProject(orgId, name)` → `createCluster(projectId, name, M0/TENANT/AWS US_EAST_1)` → `waitForCluster(IDLE)` → `createDatabaseUser` → `addIpAllowlist(0.0.0.0/0)` → build URI → register `StorageCluster`, mark active, deactivate prior.
- **Org cap (~250 clusters):** when the current org is full, roll to the user's next `OrgKey`. If the user has no org with capacity, mark storage full and surface an in-app prompt: "Add another Atlas org to keep uploading."
- Naming: `shard-<userSlug>-<orgIndex>-<n>` for project + cluster.
- `withOrgApiAccessListRetry` handles Atlas `ORG_REQUIRES_ACCESS_LIST` by auto-adding the server IP (from Aura).

---

## 6. Auth

- **Google + GitHub OAuth.** Client IDs/secrets configured in the setup wizard. First successful sign-in → `admin`.
- **Sessions:** JWT in httpOnly cookie; `Session` records in starter DB.
- **API keys:** minted in settings; REST API authenticates via `Authorization: Bearer <key>` (and updates `lastUsed`).

---

## 7. Features (web app)

Drive UI (Google-Drive-like): drag-drop upload with progress, folders + breadcrumbs, grid/list toggle, previews (image/video/pdf/text), rename/move/copy, **recycle bin**, **starred**, search, multi-select.
Sharing: per-user shares (view/edit), **"Shared with me"**.
Public links: slug + optional expiry, public download page.
Encryption: optional per-user AES-256 (client-relative; key stored on User, like D-Drive).
**Storage dashboard:** per-org and per-cluster usage bars, total capacity, live autoscale status/provisioning indicator, "add org" CTA.
Settings: manage Atlas org keys (add/label/remove), API keys, theme, account.

---

## 8. REST API (versioned `/api/v1`)

Key-authenticated endpoints (mirrors session routes):
- `GET /v1/me`, `GET /v1/storage` (usage/clusters)
- `GET /v1/files?path=`, `GET /v1/files/:id`, `GET /v1/files/:id/download`
- `POST /v1/files` (upload, multipart), `POST /v1/folders`
- `PATCH /v1/files/:id` (rename/move/star), `DELETE /v1/files/:id`
- `POST /v1/files/:id/share`, `POST /v1/files/:id/public-link`
Documented in `docs/API.md`. Designed so a CLI can wrap it later.

---

## 9. Setup wizard (hand-built, branded)

A genuinely designed multi-step flow (distinctive type/layout via frontend-design — NOT a centered card with gradient blobs):
1. **Starter cluster** — paste MongoDB connection URI + "Test connection" (ping).
2. **OAuth** — Google + GitHub client ID/secret, each with inline "how to get these" guidance.
3. **Site** — public URL / allowed origins (CORS), JWT secret auto-generated.
4. **First sign-in** — sign in via OAuth → become admin.

Writes config to `.env` + a `setup-complete` marker (D-Drive mechanism: `routes/setup.ts`, env-write + `process.env` live update, no restart). After setup, *users* add their own Atlas org keys inside the app; the operator never handles Atlas keys.

---

## 10. Branding

**Shard** — sharp, geometric, faceted/crystal motif; one confident accent color; real type pairing; a small brand system (logo mark, palette, typography, reusable components) produced via the frontend-design skill. Familiar drive UX, distinct from D-Drive's Google-clone look.

---

## 11. Deployment

- Docker Compose (backend + frontend + reverse proxy), env-driven config.
- Deployed over SSH to `jasonzli@pi.local`, **replacing** the running D-Drive instance. Existing D-Drive backed up first (copy of dir + DB dump). Health-checked and smoke-tested before "done."

---

## 12. Testing — "fully finished" bar

- **Unit:** storage routing/splitting, autoscaler threshold + org-rollover, Atlas client (digest auth, URI build, access-list retry), auth (JWT, API key), slug/crypto utils.
- **Integration:** against a real starter Mongo (test DB) — models, file tree ops, share/link logic. Atlas calls mocked at the HTTP layer.
- **E2E (Playwright):** setup → OAuth sign-in (mocked provider) → upload → download → folder ops → share → public link → recycle bin → autoscale trigger (mocked Atlas provisioning) → dashboard reflects new cluster.
- No stubs/TODOs in shipped code.

---

## 13. Execution plan (phases, Sonnet subagents)

1. Scaffold (repo, TS configs, Docker, env example, Mongoose connection to starter).
2. Metadata models + auth (OAuth, sessions, API keys).
3. Atlas client + cluster-manager + autoscaler (ported/adapted from Aura, per-user).
4. Storage service (GridFS put/get/delete, routing, splitting, encryption).
5. REST API (`/api/v1`) + session routes.
6. Drive UI (upload/download/folders/preview/recycle/star/search/move).
7. Sharing + public links + storage dashboard + settings.
8. Setup wizard + Shard branding/design system.
9. Tests (unit/integration/E2E) to the bar in §12.
10. Deploy to `pi.local`, smoke test, replace D-Drive.

Planner reviews each phase before the next.

# Shard SDD Progress

Base: eb3f05a

Task 0.1/1.1/1.2 (Phase 0+1): complete (commits 0d97185..4d5f763, verified: 21/21 tests, tsc clean, frontend builds)

## Model field reference (downstream MUST use these exact names)
- User: provider('google'|'github'), providerId, email, displayName, avatarUrl?, role('admin'|'user'), encryptionEnabled, encryptionKey?
- OrgKey: userId, label, publicKey, privateKey, orgId, clusterCount
- StorageCluster: userId, orgKeyId, clusterId(string), projectId, clusterName, connectionUri, status('provisioning'|'active'|'full'|'error'|'decommissioned'), storageUsedBytes, storageCapacityBytes, lastCheckedAt
- File: userId, parentId(ObjectId|null), name, path, mimeType, size, type('file'|'folder'), starred, encrypted, deletedAt
- Blob: fileId, clusterId(ObjectId ref StorageCluster), gridfsId(ObjectId), index, size
- ApiKey, Session, Share, PublicLink per spec
Task 2.1/2.2/2.3 (Phase 2 auth): complete (commits 30f8a7f..7d56769, 56/56 tests, tsc clean)
- Note: requireAuth in backend/src/middleware/auth.ts; GET /api/me mounted directly (meHandler). Models use a set*Connection() injection pattern for tests.
Task 3.1-3.4 (Phase 3 atlas/autoscaler): complete (commits abd8569..d2c546d)
Phase 3 REVISION per user feedback: complete (commits 3eb00b9..4ffebb9, 119/119 tests)
- USABLE_BYTES=492MB packing (no 80% gate); PREWARM_THRESHOLD=0.90 background only; region configurable (OrgKey.region + ATLAS_DEFAULT_REGION); decommissionEmptyClusters in backend/src/storage/decommission.ts; ensureCapacity(userId,neededBytes) in provisioner.ts.
- Key exports: clusterManager{openCluster,getBucket(clusterId),getActiveCluster(userId),runStorageCheck(userId),USABLE_BYTES,keepalive,closeAll}; provisioner{provisionNextCluster(userId),ensureCapacity(userId,neededBytes)}
Task 4.1/4.2 (Phase 4 storage/GridFS): complete (commits 241864b..42c8c1c, 144/144)
- storageService{storeFile({userId,parentId,name,buffer,mimeType,encrypt}),readFile(fileId),deleteFileBytes(fileId),getUniqueName}; crypto{encryptBuffer,decryptBuffer,generateEncryptionKey}
Task 5.1-5.4 (Phase 5 file routes + v1 API + storage/orgs): complete (commits 222c205..cec2118, 245/245)
- services/files.ts{createFolder,list,rename,move,star,softDelete,restore,purge,search}; routes/files.ts (/api/files etc); routes/v1.ts (/api/v1, docs/API.md); routes/storage.ts (/api/storage,/api/orgs)
Task 6.1/6.2 (Phase 6 sharing+public links): complete (commits c713d04..0aba65a, 280/280)
- services/shares.ts{canAccess(userId,fileId,need)} integrated into routes/files.ts; routes/shares.ts (/api/files/:id/share,/api/shared-with-me); routes/publicLinks.ts (/api/public/:slug[/download]); PublicLink model uses createdBy (NOT userId).
Backend feature-complete. Next: Phase 7 frontend.
Phase 7a (frontend core 7.1-7.5): complete (commits 394c100..a4d0e83, 30 vitest, build OK)
- Design system: dark mineral/crystal. tokens in frontend/src/styles/theme.css. accent=Shard blue #4A90D9 (only accent). fonts: DM Serif Display (display), Inter (body), JetBrains Mono (mono). ShardMark.tsx logo. api/client.ts (axios withCredentials, base /api), AuthContext useAuth, routes.tsx. Sidebar present.
Task 7.6 (Trash/Starred/Search views): complete (commits cd78b03..11c3ae9, review clean)
Task 7.7 (Sharing UI, PublicFile, SharedWithMe): complete (commits 11c3ae9..03b8be0, 2 commits, review clean after fix pass — status preserved on interceptor)
Task 7.8 (Dashboard, Settings): complete (commits 03b8be0..e824078, 2 commits, review clean after fix pass — CSS vars enforced)
Phase 7b complete. Commits cd78b03..e824078. 53 vitest, build OK.
Phase 7b FINAL (all fixes): complete (commit 1cb10e1, 53 vitest, build OK, tsc clean)
Phase 7b (frontend 7.6-7.8): complete (commits 11c3ae9..1cb10e1, 53 vitest, build OK)
- pages: Trash,Starred,Search,SharedWithMe,PublicFile(/p/:slug no auth),Dashboard,Settings. components: ShareDialog,PublicLinkDialog. Frontend feature-complete except Setup wizard (Phase 8).
Phase 8 (setup wizard + branding): complete (commits c777040..5bef282). Backend 294 tests, frontend 84 tests, all green, both tsc clean, build OK.
- /api/setup (status,test-connection,configure). Setup.tsx 4-step wizard. logo.svg/favicon.svg, README rewritten for Shard.
FULL STACK GREEN as of this point.
Task 9 (Phase 9 E2E spec): complete (commits 9a75004..e449998, review clean)
- e2e/flows.spec.ts: 8 Playwright flows (auth redirect, login+drive, folder, upload, move, public link, trash/restore, dashboard)
- Playwright: 8 passed. Backend: 310 passed. Frontend: 84 passed.
- Bugs fixed: /api/me missing name field; mongoose default connection not established; E2E StorageCluster seeding for uploads.
Phase 9 (integration + E2E + hardening): complete (commits 9a75004..e449998). Backend 310, Frontend 84, E2E 8 Playwright flows ALL GREEN.
- e2e harness: playwright.config.ts, e2e/global-setup|teardown, e2e/flows.spec.ts (8 flows). Guarded POST /api/e2e/login (SHARD_E2E=1). scripts test:e2e, test:all.
- 3 bugs fixed: /api/me name field; index.ts now also mongoose.connect(default) for mongoose.model() models; e2e cluster seed.
- WART for final review: models split default vs named connection (both -> STARTER_URI). functional.
Final review: 3C/5I/6M. FIXED all C+I + 2 Minor (commits 87d34f1..3b5ec71). Backend 316, Frontend 84, E2E 8 ALL GREEN. Deferred M1,M3,M5,M6 (low risk).
Phase 10 (DEPLOY): COMPLETE. D-Drive backed up to ~/d-drive-backup-2026-06-22 (689M) and stopped. Shard built + running on pi.local :80 (backend healthy, setup mode). Smoke test PASS: /api/health ok, /api/setup/status setupRequired:true, frontend+assets+SPA routes 200.
Deploy fixes: setup-config persistence load, setup-mode boot, Dockerfile npm install (workspaces), frontend public copy, wget healthcheck.
User must complete setup wizard (starter Atlas URI + Google/GitHub OAuth) then 'sudo docker compose restart backend'.
PROJECT COMPLETE.

=== v2 work started ===
v2 plan: docs/superpowers/plans/2026-06-22-shard-v2.md. Order A(config-in-db)->C(access)->D(resilience)->B(vercel)->redeploy.
Live fixes shipped: setup routing (setupRequired), live connectRuntime on configure (no restart), login copy. Backend 316, Frontend 84+2 regression.

=== v2 Phase A (Config in DB) ===
Base commit: 77b6ceeb82477849d808659b0826eb7131d3154a
Plan: docs/superpowers/plans/2026-06-22-shard-v2-phase-a.md
Tasks: 1(Config model), 2(configService), 3(consumers), 4(setup.ts), 5(index+compose), 6(report)
Task 1 (Config model + index export): complete (commits 77b6cee..2280f79, review clean, +2 tests → 318 total)
v2 Phase A (config-in-DB): DONE (commits 2280f79..7f1ec7e, 331 tests). Config singleton in starter DB; getConfig() w/ env fallback; setup /configure saves to DB (no .env write — fixes EACCES). STARTER_MONGODB_URI is the only required env var.
Pi hotfix: chmod 777 ~/shard/config (unblocked old build's EACCES).
NEXT order per user: C access-control -> B vercel(+push+deploy) -> D resilience.
Phase C base: 3a80ce4
v2 C/D/B (access toggle + resilience + vercel): DONE (commits b6f8c6c..HEAD). Backend 367, Frontend 86, E2E 8 green. accessMode toggle; pending-approval; admin routes/UI; starter resilience (507 not crash); serverless api/index.ts + vercel.json (rewrites+crons); synchronous provisioning kept (<10s).
PUSHED to github.com/jasonzli-DEV/Shard (main).
Vercel deploy BLOCKED: CLI token expired (vercel whoami fails). User must re-auth or import repo on dashboard + set STARTER_MONGODB_URI env.
Chunked upload (Phase): complete (commits d1b99b5..c491ec2, backend 383 tests, frontend 88 tests, tsc clean, build OK)
- readFile: now decrypts per-blob (bug fix — was trying to decrypt combined buffer)
- storeChunk/abortUpload added to storageService; 4 new routes in files.ts
- Frontend: uploadFileChunked in api/files.ts; useUpload now uses chunked protocol

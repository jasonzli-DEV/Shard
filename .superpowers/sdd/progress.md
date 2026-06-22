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

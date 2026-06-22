# Shard REST API v1

Base URL: `/api/v1`

## Authentication

All v1 endpoints require either:
- **Session cookie**: `shard_token=<JWT>` (set on OAuth login)
- **API key header**: `Authorization: Bearer shard_<key>`

API keys can be created at `POST /api/keys` (session-auth only).

---

## User

### GET /api/v1/me

Returns the authenticated user's profile.

**Response 200:**
```json
{
  "id": "665a...",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "avatarUrl": "https://...",
  "role": "admin",
  "encryptionEnabled": false,
  "createdAt": "2026-06-22T00:00:00.000Z"
}
```

---

## Storage

### GET /api/v1/storage

Returns per-org and per-cluster storage usage for the authenticated user.

**Response 200:**
```json
{
  "orgs": [
    {
      "orgId": "665b...",
      "label": "My Atlas Org",
      "region": "US_EAST_1",
      "clusterCount": 2,
      "clusters": [
        {
          "id": "665c...",
          "clusterId": "shard-abc123-1",
          "status": "active",
          "storageUsedBytes": 104857600,
          "storageCapacityBytes": 536870912,
          "usedPercent": 20,
          "lastCheckedAt": "2026-06-22T00:00:00.000Z"
        }
      ],
      "totalUsedBytes": 104857600,
      "totalCapacityBytes": 536870912
    }
  ],
  "totalUsedBytes": 104857600,
  "totalCapacityBytes": 536870912,
  "usedPercent": 20
}
```

---

## Files

### GET /api/v1/files

List files and folders. Excludes soft-deleted items.

**Query params:**
- `parentId` (optional) — list children of this folder ObjectId
- `path` (optional) — find file by exact path (e.g. `/docs/report.pdf`)

If `path` is specified, returns an array with a single item (or 404).

**Response 200:** `IFile[]`

---

### GET /api/v1/files/:id

Get metadata for a single file or folder by its ObjectId.

**Errors:**
- `404` — not found or belongs to another user

**Response 200:** `IFile`

---

### GET /api/v1/files/:id/download

Download file bytes. Sets `Content-Disposition: attachment`.

**Errors:**
- `400` — target is a folder
- `403` — file belongs to another user
- `404` — file not found

**Response 200:** Binary file stream with correct `Content-Type`.

---

### POST /api/v1/files

Upload a file. Content type must be `multipart/form-data`.

**Form fields:**
- `file` (required) — the file to upload
- `parentId` (optional) — destination folder ObjectId (null = root)

**Response 201:** `IFile`

**Errors:**
- `400` — no file attached
- `500` — storage provisioning failed

---

### POST /api/v1/folders

Create a new folder.

**Request body (JSON):**
```json
{
  "name": "My Folder",
  "parentId": null
}
```

- `name` (required) — folder name
- `parentId` (optional) — parent folder ObjectId (null = root)

**Response 201:** `IFile` (with `type: "folder"`)

**Errors:**
- `400` — name missing or invalid
- `404` — parentId not found
- `409` — a file/folder already exists at that path

---

### PATCH /api/v1/files/:id

Update a file or folder. Provide one or more of:

**Request body (JSON):**
```json
{
  "name": "new-name.txt",
  "parentId": "665d...",
  "starred": true
}
```

- `name` — rename; if folder, recursively updates descendant paths
- `parentId` — move to new parent (null = move to root)
- `starred` — boolean to star/unstar

**Response 200:** Updated `IFile`

**Errors:**
- `400` — no valid field / invalid move (into self or descendant)
- `404` — file not found
- `409` — rename/move would conflict with existing path

---

### DELETE /api/v1/files/:id

Soft-delete a file or folder. Moves to recycle bin (`deletedAt` set).
Does not delete bytes.

**Response 200:**
```json
{ "message": "File moved to trash" }
```

**Errors:**
- `404` — file not found or already deleted

---

## IFile Object Shape

```typescript
{
  _id: string;             // MongoDB ObjectId
  userId: string;          // Owning user's ObjectId
  parentId: string | null; // Parent folder's ObjectId, or null for root
  name: string;            // File or folder name
  path: string;            // Full path, e.g. "/docs/report.pdf"
  mimeType: string;        // MIME type ("application/x-directory" for folders)
  size: number;            // Size in bytes (0 for folders)
  type: "file" | "folder";
  starred: boolean;
  encrypted: boolean;
  deletedAt: string | null; // ISO date when soft-deleted, null otherwise
  createdAt: string;
  updatedAt: string;
}
```

---

## Session-only endpoints (at `/api`)

These endpoints use the same logic but are only exposed in the session-auth layer:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/files` | List files (parentId query) |
| `POST` | `/api/files` | Upload file (multipart) |
| `GET` | `/api/files/:id/download` | Download file |
| `POST` | `/api/folders` | Create folder |
| `PATCH` | `/api/files/:id` | Rename / move / star |
| `DELETE` | `/api/files/:id` | Soft delete |
| `GET` | `/api/trash` | List recycle bin |
| `POST` | `/api/files/:id/restore` | Restore from trash |
| `DELETE` | `/api/files/:id/purge` | Permanently delete + remove bytes |
| `GET` | `/api/search?q=` | Search by filename |
| `GET` | `/api/storage` | Storage stats |
| `GET` | `/api/orgs` | List org keys |
| `POST` | `/api/orgs` | Add org key (validates with Atlas) |
| `DELETE` | `/api/orgs/:id` | Remove org key |

import client from './client';

export interface FileItem {
  _id: string;
  name: string;
  type: 'file' | 'folder';
  mimeType?: string;
  size?: number;
  parentId: string | null;
  starred: boolean;
  deleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  path: string;
  encrypted: boolean;
}

export interface CreateFolderPayload {
  name: string;
  parentId: string | null;
}

export interface UpdateFilePayload {
  name?: string;
  parentId?: string | null;
  starred?: boolean;
}

/** List files in a folder (null = root). */
export async function listFiles(parentId: string | null): Promise<FileItem[]> {
  const params = parentId ? { parentId } : {};
  const { data } = await client.get<FileItem[]>('/files', { params });
  return data;
}

/** Create a folder. */
export async function createFolder(payload: CreateFolderPayload): Promise<FileItem> {
  const { data } = await client.post<FileItem>('/folders', payload);
  return data;
}

/** Upload a file with progress callback. */
export async function uploadFile(
  file: File,
  parentId: string | null,
  onProgress?: (percent: number) => void,
): Promise<FileItem> {
  const form = new FormData();
  form.append('file', file);
  if (parentId) form.append('parentId', parentId);

  const { data } = await client.post<FileItem>('/files', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
  return data;
}

/** Download a file — returns a blob URL for the browser to use. */
export function getDownloadUrl(fileId: string): string {
  return `/api/files/${fileId}/download`;
}

/** Trigger browser download for a file. */
export async function downloadFile(fileId: string, name: string): Promise<void> {
  const { data } = await client.get<Blob>(`/files/${fileId}/download`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Update a file (rename, move, star). */
export async function updateFile(
  fileId: string,
  payload: UpdateFilePayload,
): Promise<FileItem> {
  const { data } = await client.patch<FileItem>(`/files/${fileId}`, payload);
  return data;
}

/** Soft-delete a file (moves to trash). */
export async function deleteFile(fileId: string): Promise<void> {
  await client.delete(`/files/${fileId}`);
}

/** Restore a file from trash. */
export async function restoreFile(fileId: string): Promise<FileItem> {
  const { data } = await client.post<FileItem>(`/files/${fileId}/restore`);
  return data;
}

/** Permanently delete a file. */
export async function purgeFile(fileId: string): Promise<void> {
  await client.delete(`/files/${fileId}/purge`);
}

/** List trashed files. */
export async function listTrash(): Promise<FileItem[]> {
  const { data } = await client.get<FileItem[]>('/trash');
  return data;
}

/** Search files. */
export async function searchFiles(q: string): Promise<FileItem[]> {
  const { data } = await client.get<FileItem[]>('/search', { params: { q } });
  return data;
}

// ── Sharing ──────────────────────────────────────────────────────────────────

export interface ShareItem {
  _id: string;
  fileId: string;
  sharedWithId: string;
  sharedWithEmail?: string;
  sharedWithName?: string;
  permission: 'view' | 'edit';
  createdAt: string;
}

export async function createShare(fileId: string, email: string, permission: 'view' | 'edit'): Promise<ShareItem> {
  const { data } = await client.post<ShareItem>(`/files/${fileId}/share`, { email, permission });
  return data;
}

export async function listShares(fileId: string): Promise<ShareItem[]> {
  const { data } = await client.get<ShareItem[]>(`/files/${fileId}/shares`);
  return data;
}

export async function removeShare(fileId: string, userId: string): Promise<void> {
  await client.delete(`/files/${fileId}/share/${userId}`);
}

// ── Public links ─────────────────────────────────────────────────────────────

export interface PublicLinkItem {
  _id: string;
  fileId: string;
  slug: string;
  expiresAt?: string;
  downloadCount: number;
  createdAt: string;
}

export async function createPublicLink(fileId: string, expiresIn?: number): Promise<PublicLinkItem> {
  const { data } = await client.post<PublicLinkItem>(`/files/${fileId}/public-link`, expiresIn ? { expiresIn } : {});
  return data;
}

export async function listPublicLinks(): Promise<PublicLinkItem[]> {
  const { data } = await client.get<PublicLinkItem[]>('/public-links');
  return data;
}

export async function deletePublicLink(linkId: string): Promise<void> {
  await client.delete(`/public-links/${linkId}`);
}

// ── Shared with me ────────────────────────────────────────────────────────────

export interface SharedWithMeItem {
  _id: string;
  file: FileItem;
  owner: { _id: string; name: string; email: string };
  permission: 'view' | 'edit';
  createdAt: string;
}

export async function listSharedWithMe(): Promise<SharedWithMeItem[]> {
  const { data } = await client.get<SharedWithMeItem[]>('/shared-with-me');
  return data;
}

// ── Public file access (unauthenticated) ─────────────────────────────────────

export interface PublicFileMeta {
  _id: string;
  name: string;
  path: string;
  type: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  updatedAt: string;
}

export async function getPublicFile(slug: string): Promise<PublicFileMeta> {
  const { data } = await client.get(`/public/${slug}`);
  return data;
}

export function getPublicDownloadUrl(slug: string): string {
  return `/api/public/${slug}/download`;
}

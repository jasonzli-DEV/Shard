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

import { useCallback, useState } from 'react';
import { uploadFile } from '../api/files';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

export function useUpload(
  folderId: string | null,
  onComplete?: () => void,
) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const updateUpload = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    );
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const newItems: UploadItem[] = files.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        name: f.name,
        status: 'pending',
        progress: 0,
      }));

      setUploads((prev) => [...prev, ...newItems]);

      const promises = files.map(async (file, i) => {
        const item = newItems[i];
        updateUpload(item.id, { status: 'uploading' });

        try {
          await uploadFile(file, folderId, (percent) => {
            updateUpload(item.id, { progress: percent });
          });
          updateUpload(item.id, { status: 'done', progress: 100 });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          updateUpload(item.id, { status: 'error', error: message });
        }
      });

      await Promise.all(promises);
      onComplete?.();

      // Remove completed uploads after a short delay
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status !== 'done'));
      }, 2500);
    },
    [folderId, updateUpload, onComplete],
  );

  return { uploads, uploadFiles };
}


interface IconProps {
  size?: number;
  color?: string;
}

export function FolderIcon({ size = 20, color = '#4A90D9' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        fill={color}
        opacity="0.9"
      />
    </svg>
  );
}

export function FileIcon({ size = 20, mimeType }: IconProps & { mimeType?: string }) {
  const color = getFileColor(mimeType);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        fill={color}
        opacity="0.75"
      />
      <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function StarIcon({ size = 14, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#E0A652' : 'none'} stroke={filled ? '#E0A652' : 'currentColor'} strokeWidth="2" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function getFileColor(mimeType?: string): string {
  if (!mimeType) return '#8B92A8';
  if (mimeType.startsWith('image/')) return '#4CAF7D';
  if (mimeType.startsWith('video/')) return '#E05252';
  if (mimeType.startsWith('audio/')) return '#E0A652';
  if (mimeType === 'application/pdf') return '#E05252';
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return '#4A90D9';
  return '#8B92A8';
}

export function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

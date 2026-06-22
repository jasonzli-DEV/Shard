import type { UploadItem } from '../hooks/useUpload';
import './UploadProgress.css';

interface UploadProgressProps {
  uploads: UploadItem[];
}

export default function UploadProgress({ uploads }: UploadProgressProps) {
  if (uploads.length === 0) return null;

  return (
    <div
      className="upload-progress-panel"
      role="status"
      aria-live="polite"
      aria-label="Upload progress"
      data-testid="upload-progress"
    >
      <div className="upload-progress-header">
        <span className="upload-progress-title">Uploading {uploads.length} file{uploads.length !== 1 ? 's' : ''}</span>
      </div>
      <ul className="upload-progress-list">
        {uploads.map((item) => (
          <li key={item.id} className={`upload-progress-item upload-progress-item--${item.status}`}>
            <div className="upload-progress-name truncate">{item.name}</div>
            <div className="upload-progress-bar-wrap">
              <div
                className="upload-progress-bar"
                style={{ width: `${item.progress}%` }}
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.name} upload progress`}
              />
            </div>
            <span className="upload-progress-status font-mono">
              {item.status === 'error'
                ? item.error ?? 'Error'
                : item.status === 'done'
                ? '✓'
                : `${item.progress}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

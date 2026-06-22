import { useEffect, useState } from 'react';
import type { FileItem } from '../api/files';
import { getDownloadUrl } from '../api/files';
import './PreviewModal.css';

interface PreviewModalProps {
  file: FileItem;
  onClose: () => void;
}

type PreviewKind = 'image' | 'video' | 'pdf' | 'text' | 'unsupported';

function getPreviewKind(file: FileItem): PreviewKind {
  const mime = file.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return 'text';
  return 'unsupported';
}

export default function PreviewModal({ file, onClose }: PreviewModalProps) {
  const kind = getPreviewKind(file);
  const downloadUrl = getDownloadUrl(file._id);
  const [textContent, setTextContent] = useState<string | null>(null);

  // Fetch text preview for text files
  useEffect(() => {
    if (kind !== 'text') return;
    fetch(downloadUrl, { credentials: 'include' })
      .then((r) => r.text())
      .then((t) => setTextContent(t.slice(0, 8000)))
      .catch(() => setTextContent('Unable to load preview.'));
  }, [kind, downloadUrl]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="preview-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${file.name}`}
      data-testid="preview-modal"
    >
      <div className="preview-shell">
        <header className="preview-header">
          <span className="preview-filename truncate">{file.name}</span>
          <a
            href={downloadUrl}
            className="preview-download"
            download={file.name}
          >
            Download
          </a>
          <button
            className="preview-close"
            onClick={onClose}
            aria-label="Close preview"
            type="button"
          >
            ✕
          </button>
        </header>

        <div className="preview-body">
          {kind === 'image' && (
            <img
              src={downloadUrl}
              alt={file.name}
              className="preview-image"
              data-testid="preview-image"
            />
          )}
          {kind === 'video' && (
            <video
              src={downloadUrl}
              controls
              className="preview-video"
              data-testid="preview-video"
            />
          )}
          {kind === 'pdf' && (
            <iframe
              src={downloadUrl}
              title={file.name}
              className="preview-pdf"
              data-testid="preview-pdf"
            />
          )}
          {kind === 'text' && (
            <pre className="preview-text font-mono" data-testid="preview-text">
              {textContent ?? 'Loading…'}
            </pre>
          )}
          {kind === 'unsupported' && (
            <div className="preview-unsupported" data-testid="preview-unsupported">
              <p>Preview not available for this file type.</p>
              <a href={downloadUrl} download={file.name} className="preview-dl-link">
                Download to open
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

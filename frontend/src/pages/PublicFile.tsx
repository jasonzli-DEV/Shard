import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ShardMark from '../components/ShardMark';
import { getPublicFile, getPublicDownloadUrl } from '../api/files';
import type { PublicFileMeta } from '../api/files';
import '../styles/theme.css';
import './PublicFile.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function PublicFile() {
  const { slug } = useParams<{ slug: string }>();
  const [file, setFile] = useState<PublicFileMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    getPublicFile(slug)
      .then((data) => {
        setFile(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status === 404 || status === 410) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <div className="pubfile-shell">
        <div className="pubfile-facet" aria-hidden="true" />
        <div className="pubfile-loading" aria-label="Loading" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="pubfile-shell">
        <div className="pubfile-facet" aria-hidden="true" />
        <div className="pubfile-card" data-testid="pubfile-not-found">
          <div className="pubfile-brand">
            <ShardMark size={40} />
            <span className="pubfile-wordmark">Shard</span>
          </div>
          <p className="pubfile-expired">
            This link has expired or does not exist.
          </p>
        </div>
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="pubfile-shell">
        <div className="pubfile-facet" aria-hidden="true" />
        <div className="pubfile-card">
          <div className="pubfile-brand">
            <ShardMark size={40} />
            <span className="pubfile-wordmark">Shard</span>
          </div>
          <p className="pubfile-error">{error ?? 'An error occurred.'}</p>
        </div>
      </div>
    );
  }

  const downloadUrl = getPublicDownloadUrl(slug!);

  return (
    <div className="pubfile-shell">
      <div className="pubfile-facet" aria-hidden="true" />
      <div className="pubfile-card" data-testid="pubfile-card">
        <div className="pubfile-brand">
          <ShardMark size={40} />
          <span className="pubfile-wordmark">Shard</span>
        </div>

        <div className="pubfile-icon" aria-hidden="true">
          <FileIcon />
        </div>

        <h1 className="pubfile-name" data-testid="pubfile-name">{file.name}</h1>

        <dl className="pubfile-meta">
          {file.mimeType && (
            <>
              <dt>Type</dt>
              <dd className="font-mono">{file.mimeType}</dd>
            </>
          )}
          {file.size != null && (
            <>
              <dt>Size</dt>
              <dd className="font-mono">{formatBytes(file.size)}</dd>
            </>
          )}
          <dt>Added</dt>
          <dd>{new Date(file.createdAt).toLocaleDateString()}</dd>
        </dl>

        <a
          className="pubfile-download-btn"
          href={downloadUrl}
          download={file.name}
          data-testid="pubfile-download"
        >
          <DownloadIcon />
          Download
        </a>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

import { useEffect, useState } from 'react';
import { createPublicLink, listPublicLinks, deletePublicLink } from '../api/files';
import type { FileItem, PublicLinkItem } from '../api/files';
import './PublicLinkDialog.css';

interface PublicLinkDialogProps {
  file: FileItem;
  onClose: () => void;
}

export default function PublicLinkDialog({ file, onClose }: PublicLinkDialogProps) {
  const [links, setLinks] = useState<PublicLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expiryHours, setExpiryHours] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Load existing public links for this file
  useEffect(() => {
    setLoading(true);
    listPublicLinks()
      .then((all) => setLinks(all.filter((l) => l.fileId === file._id)))
      .catch(() => setError('Failed to load links'))
      .finally(() => setLoading(false));
  }, [file._id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const hours = parseFloat(expiryHours);
      const expiresIn = expiryHours.trim() && !isNaN(hours) && hours > 0
        ? Math.round(hours * 3600)
        : undefined;
      const link = await createPublicLink(file._id, expiresIn);
      setLinks((prev) => [link, ...prev]);
      setExpiryHours('');
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { error?: string } } };
      setError(anyErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'Create failed'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(link: PublicLinkItem) {
    setError(null);
    try {
      await deletePublicLink(link._id);
      setLinks((prev) => prev.filter((l) => l._id !== link._id));
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { error?: string } } };
      setError(anyErr?.response?.data?.error ?? 'Delete failed');
    }
  }

  async function handleCopy(slug: string) {
    const url = `${window.location.origin}/p/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch {
      // fallback: select the text
    }
  }

  function buildUrl(slug: string) {
    return `${window.location.origin}/p/${slug}`;
  }

  return (
    <div
      className="publink-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Public link for "${file.name}"`}
      data-testid="publink-dialog"
    >
      <div className="publink-shell">
        <header className="publink-header">
          <h2 className="publink-title">Public link: {file.name}</h2>
          <button className="publink-close" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </header>

        {/* Create link form */}
        <form className="publink-form" onSubmit={handleCreate}>
          <label className="publink-expiry-label" htmlFor="publink-expiry">
            Expires in (hours, optional)
          </label>
          <div className="publink-form-row">
            <input
              id="publink-expiry"
              className="publink-expiry-input"
              type="number"
              min="0.1"
              step="0.5"
              placeholder="Never"
              value={expiryHours}
              onChange={(e) => setExpiryHours(e.target.value)}
              aria-label="Expiry in hours"
            />
            <button
              className="publink-btn-create"
              type="submit"
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>
        </form>

        {error && <p className="publink-error" role="alert">{error}</p>}

        {/* Existing links */}
        <div className="publink-list-section">
          <h3 className="publink-list-heading">Active links</h3>
          {loading ? (
            <p className="publink-list-empty">Loading…</p>
          ) : links.length === 0 ? (
            <p className="publink-list-empty">No public links yet.</p>
          ) : (
            <ul className="publink-list">
              {links.map((link) => (
                <li key={link._id} className="publink-list-item">
                  <div className="publink-url-row">
                    <span className="publink-url font-mono">{buildUrl(link.slug)}</span>
                    <button
                      className="publink-btn-copy"
                      onClick={() => handleCopy(link.slug)}
                      type="button"
                      aria-label="Copy link"
                    >
                      {copiedSlug === link.slug ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="publink-meta">
                    <span className="publink-downloads">
                      {link.downloadCount} download{link.downloadCount !== 1 ? 's' : ''}
                    </span>
                    {link.expiresAt && (
                      <span className="publink-expires">
                        Expires {new Date(link.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      className="publink-btn-delete"
                      onClick={() => handleDelete(link)}
                      type="button"
                      aria-label="Delete link"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="publink-footer">
          <button className="publink-btn-done" onClick={onClose} type="button">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

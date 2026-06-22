import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createShare, listShares, removeShare } from '../api/files';
import type { FileItem, ShareItem } from '../api/files';
import './ShareDialog.css';

interface ShareDialogProps {
  file: FileItem;
  onClose: () => void;
  onChanged?: () => void;
}

export default function ShareDialog({ file, onClose, onChanged }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: shares = [], isLoading: sharesLoading } = useQuery({
    queryKey: ['shares', file._id],
    queryFn: () => listShares(file._id),
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSharing(true);
    setError(null);
    try {
      await createShare(file._id, trimmed, permission);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['shares', file._id] });
      onChanged?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Share failed';
      // Try to extract server error message
      const anyErr = err as { response?: { data?: { error?: string } } };
      setError(anyErr?.response?.data?.error ?? msg);
    } finally {
      setSharing(false);
    }
  }

  async function handleRemove(share: ShareItem) {
    setError(null);
    try {
      await removeShare(file._id, share.sharedWithId);
      queryClient.invalidateQueries({ queryKey: ['shares', file._id] });
      onChanged?.();
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { error?: string } } };
      setError(anyErr?.response?.data?.error ?? 'Remove failed');
    }
  }

  return (
    <div
      className="share-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Share "${file.name}"`}
      data-testid="share-dialog"
    >
      <div className="share-shell">
        <header className="share-header">
          <h2 className="share-title">Share: {file.name}</h2>
          <button className="share-close" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </header>

        {/* Share form */}
        <form className="share-form" onSubmit={handleShare}>
          <input
            className="share-email-input"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address to share with"
            required
          />
          <select
            className="share-permission-select"
            value={permission}
            onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}
            aria-label="Permission level"
          >
            <option value="view">Can view</option>
            <option value="edit">Can edit</option>
          </select>
          <button
            className="share-btn-share"
            type="submit"
            disabled={sharing || !email.trim()}
          >
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </form>

        {error && <p className="share-error" role="alert">{error}</p>}

        {/* Existing shares */}
        <div className="share-list-section">
          <h3 className="share-list-heading">People with access</h3>
          {sharesLoading ? (
            <p className="share-list-empty">Loading…</p>
          ) : shares.length === 0 ? (
            <p className="share-list-empty">Not shared with anyone yet.</p>
          ) : (
            <ul className="share-list">
              {shares.map((share) => (
                <li key={share._id} className="share-list-item">
                  <div className="share-user-info">
                    <span className="share-user-email">
                      {share.sharedWithName || share.sharedWithEmail || share.sharedWithId}
                    </span>
                    {share.sharedWithName && share.sharedWithEmail && (
                      <span className="share-user-name">{share.sharedWithEmail}</span>
                    )}
                  </div>
                  <span className={`share-permission-badge share-permission-badge--${share.permission}`}>
                    {share.permission}
                  </span>
                  <button
                    className="share-btn-remove"
                    onClick={() => handleRemove(share)}
                    type="button"
                    aria-label={`Remove access for ${share.sharedWithEmail ?? share.sharedWithId}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="share-footer">
          <button className="share-btn-done" onClick={onClose} type="button">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

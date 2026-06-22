import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listFiles, updateFile } from '../api/files';
import type { FileItem } from '../api/files';
import './MoveDialog.css';

interface MoveDialogProps {
  file: FileItem;
  onClose: () => void;
  onMoved: () => void;
}

export default function MoveDialog({ file, onClose, onMoved }: MoveDialogProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [path, setPath] = useState<Array<{ id: string | null; name: string }>>([
    { id: null, name: 'My Drive' },
  ]);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['move-dialog-files', currentFolderId],
    queryFn: () => listFiles(currentFolderId),
  });

  const folders = items.filter((f) => f.type === 'folder' && f._id !== file._id);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function navigateTo(id: string | null, name: string) {
    setCurrentFolderId(id);
    const existing = path.findIndex((p) => p.id === id);
    if (existing >= 0) {
      setPath(path.slice(0, existing + 1));
    } else {
      setPath([...path, { id, name }]);
    }
  }

  async function handleMove() {
    if (currentFolderId === file.parentId) {
      onClose();
      return;
    }
    setMoving(true);
    setError(null);
    try {
      await updateFile(file._id, { parentId: currentFolderId });
      onMoved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div
      className="move-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Move "${file.name}"`}
      data-testid="move-dialog"
    >
      <div className="move-shell">
        <header className="move-header">
          <h2 className="move-title">Move "{file.name}"</h2>
          <button className="move-close" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </header>

        {/* Breadcrumb */}
        <nav className="move-breadcrumb" aria-label="Navigation">
          {path.map((seg, i) => (
            <React.Fragment key={seg.id ?? 'root'}>
              {i > 0 && <span className="move-sep">/</span>}
              <button
                className="move-crumb"
                onClick={() => navigateTo(seg.id, seg.name)}
                type="button"
              >
                {seg.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* Folder list */}
        <ul className="move-folder-list" role="listbox" aria-label="Choose destination">
          {folders.length === 0 && (
            <li className="move-empty">No folders here</li>
          )}
          {folders.map((f) => (
            <li key={f._id}>
              <button
                className={`move-folder-item ${currentFolderId === f._id ? 'selected' : ''}`}
                onClick={() => navigateTo(f._id, f.name)}
                role="option"
                aria-selected={currentFolderId === f._id}
                type="button"
              >
                <FolderSmIcon />
                {f.name}
              </button>
            </li>
          ))}
        </ul>

        {error && <p className="move-error">{error}</p>}

        <footer className="move-footer">
          <button className="move-btn-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="move-btn-confirm"
            onClick={handleMove}
            disabled={moving}
            type="button"
            data-testid="move-confirm"
          >
            {moving ? 'Moving…' : `Move here`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FolderSmIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#4A90D9" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" opacity="0.8" />
    </svg>
  );
}

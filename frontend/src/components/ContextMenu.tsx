import { useCallback, useEffect, useRef, useState } from 'react';
import { updateFile } from '../api/files';
import type { FileItem } from '../api/files';
import './ContextMenu.css';

interface ContextMenuProps {
  file: FileItem;
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onMove: () => void;
  onRefresh: () => void;
  onShare?: () => void;
  onPublicLink?: () => void;
}

export default function ContextMenu({
  file,
  x,
  y,
  onClose,
  onDelete,
  onDownload,
  onMove,
  onRefresh,
  onShare,
  onPublicLink,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);

  // Clamp to viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    setPos({
      x: x + rect.width > vpW ? vpW - rect.width - 8 : x,
      y: y + rect.height > vpH ? vpH - rect.height - 8 : y,
    });
  }, [x, y]);

  // Close on outside click / Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name || name === file.name) {
      setRenaming(false);
      return;
    }
    await updateFile(file._id, { name });
    onRefresh();
    onClose();
  }, [renameValue, file, onRefresh, onClose]);

  const handleStar = useCallback(async () => {
    await updateFile(file._id, { starred: !file.starred });
    onRefresh();
    onClose();
  }, [file, onRefresh, onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label={`Actions for ${file.name}`}
      data-testid="context-menu"
    >
      {renaming ? (
        <div className="ctx-menu-rename">
          <input
            className="ctx-menu-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus
            aria-label="New name"
          />
          <button
            className="ctx-menu-rename-confirm"
            onClick={handleRename}
            type="button"
          >
            Rename
          </button>
        </div>
      ) : (
        <>
          <button
            className="ctx-menu-item"
            onClick={() => setRenaming(true)}
            role="menuitem"
            type="button"
            data-testid="ctx-rename"
          >
            Rename
          </button>

          <button
            className="ctx-menu-item"
            onClick={onMove}
            role="menuitem"
            type="button"
            data-testid="ctx-move"
          >
            Move to…
          </button>

          <button
            className="ctx-menu-item"
            onClick={handleStar}
            role="menuitem"
            type="button"
            data-testid="ctx-star"
          >
            {file.starred ? 'Remove star' : 'Star'}
          </button>

          {file.type !== 'folder' && (
            <button
              className="ctx-menu-item"
              onClick={onDownload}
              role="menuitem"
              type="button"
              data-testid="ctx-download"
            >
              Download
            </button>
          )}

          {onShare && (
            <button
              className="ctx-menu-item"
              onClick={onShare}
              role="menuitem"
              type="button"
              data-testid="ctx-share"
            >
              Share…
            </button>
          )}

          {onPublicLink && file.type !== 'folder' && (
            <button
              className="ctx-menu-item"
              onClick={onPublicLink}
              role="menuitem"
              type="button"
              data-testid="ctx-public-link"
            >
              Get public link
            </button>
          )}

          <div className="ctx-menu-divider" role="separator" />

          <button
            className="ctx-menu-item ctx-menu-item--danger"
            onClick={onDelete}
            role="menuitem"
            type="button"
            data-testid="ctx-delete"
          >
            Move to trash
          </button>
        </>
      )}
    </div>
  );
}

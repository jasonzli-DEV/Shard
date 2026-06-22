import React, { useRef } from 'react';
import './Toolbar.css';

type ViewMode = 'grid' | 'list';

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewFolder: () => void;
  onUpload: (files: File[]) => void;
  currentFolderId: string | null;
}

export default function Toolbar({
  viewMode,
  onViewModeChange,
  onNewFolder,
  onUpload,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onUpload(files);
    // Reset so re-uploading same file triggers onChange
    e.target.value = '';
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="File actions">
      <div className="toolbar-left">
        <button
          className="toolbar-btn toolbar-btn-primary"
          onClick={onNewFolder}
          type="button"
        >
          <FolderPlusIcon />
          New folder
        </button>

        <button
          className="toolbar-btn"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <UploadIcon />
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="toolbar-file-input"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileInput}
        />
      </div>

      <div className="toolbar-right">
        <div className="toolbar-view-toggle" role="group" aria-label="View mode">
          <button
            className={`toolbar-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => onViewModeChange('grid')}
            aria-pressed={viewMode === 'grid'}
            title="Grid view"
            type="button"
          >
            <GridIcon />
          </button>
          <button
            className={`toolbar-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => onViewModeChange('list')}
            aria-pressed={viewMode === 'list'}
            title="List view"
            type="button"
          >
            <ListIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

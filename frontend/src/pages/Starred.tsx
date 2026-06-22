import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import FileGrid from '../components/FileGrid';
import FileRow from '../components/FileRow';
import { listFiles } from '../api/files';
import type { FileItem } from '../api/files';
import './Drive.css';
import './Starred.css';

type ViewMode = 'grid' | 'list';

export default function Starred() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const { data: allFiles = [], isLoading } = useQuery({
    queryKey: ['files', null],
    queryFn: () => listFiles(null),
  });

  const starredFiles = allFiles.filter((f: FileItem) => f.starred);

  const handleSectionNavigate = useCallback(
    (section: string) => {
      if (section === 'drive') navigate('/');
      else if (section === 'trash') navigate('/trash');
      else if (section === 'search') navigate('/search');
    },
    [navigate],
  );

  const handleOpenFile = useCallback(
    (file: FileItem) => {
      if (file.type === 'folder') {
        navigate(`/folder/${file._id}`);
      }
      // For files, no-op in starred view (no preview modal here)
    },
    [navigate],
  );

  // No-op context menu — starred view doesn't need full context menu
  const handleContextMenu = useCallback((_file: FileItem, _event: React.MouseEvent) => {}, []);

  return (
    <div className="drive-shell">
      <Sidebar currentSection="starred" onNavigate={handleSectionNavigate} />

      <div className="drive-main">
        <header className="drive-header starred-header">
          <h1 className="starred-heading">Starred</h1>
          <div className="starred-view-toggle">
            <button
              className={`starred-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              type="button"
              title="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <GridIcon />
            </button>
            <button
              className={`starred-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              type="button"
              title="List view"
              aria-pressed={viewMode === 'list'}
            >
              <ListIcon />
            </button>
          </div>
        </header>

        <div className="drive-body">
          {isLoading ? (
            <div className="drive-loading" aria-label="Loading starred files" />
          ) : starredFiles.length === 0 ? (
            <div className="starred-empty">
              <p>No starred files yet.</p>
              <p className="starred-empty-hint">
                Right-click any file and choose Star to add it here.
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <FileGrid
              files={starredFiles}
              onOpen={handleOpenFile}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <FileRow
              files={starredFiles}
              onOpen={handleOpenFile}
              onContextMenu={handleContextMenu}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import Breadcrumbs, { BreadcrumbSegment } from '../components/Breadcrumbs';
import Toolbar from '../components/Toolbar';
import FileGrid from '../components/FileGrid';
import FileRow from '../components/FileRow';
import ContextMenu from '../components/ContextMenu';
import PreviewModal from '../components/PreviewModal';
import MoveDialog from '../components/MoveDialog';
import UploadZone from '../components/UploadZone';
import UploadProgress from '../components/UploadProgress';
import { useUpload } from '../hooks/useUpload';
import { listFiles, createFolder, deleteFile, downloadFile } from '../api/files';
import type { FileItem } from '../api/files';
import './Drive.css';

type ViewMode = 'grid' | 'list';
type Section = 'drive' | 'starred' | 'search' | 'trash';

export default function Drive() {
  const { folderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const currentFolderId = folderId ?? null;

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [section, setSection] = useState<Section>('drive');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([
    { id: null, name: 'My Drive' },
  ]);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    file: FileItem;
    x: number;
    y: number;
  } | null>(null);

  // Preview modal
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // Move dialog
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);

  const { uploads, uploadFiles } = useUpload(currentFolderId, () => {
    queryClient.invalidateQueries({ queryKey: ['files', currentFolderId] });
  });

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files', currentFolderId],
    queryFn: () => listFiles(currentFolderId),
  });

  const handleOpenFile = useCallback(
    (file: FileItem) => {
      if (file.type === 'folder') {
        const newCrumbs = [...breadcrumbs, { id: file._id, name: file.name }];
        setBreadcrumbs(newCrumbs);
        navigate(`/folder/${file._id}`);
      } else {
        setPreviewFile(file);
      }
    },
    [breadcrumbs, navigate],
  );

  const handleBreadcrumbNavigate = useCallback(
    (targetId: string | null) => {
      const idx = breadcrumbs.findIndex((b) => b.id === targetId);
      if (idx >= 0) {
        setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
      }
      if (targetId === null) {
        navigate('/');
      } else {
        navigate(`/folder/${targetId}`);
      }
    },
    [breadcrumbs, navigate],
  );

  const handleContextMenu = useCallback(
    (file: FileItem, event: React.MouseEvent) => {
      setCtxMenu({ file, x: event.clientX, y: event.clientY });
    },
    [],
  );

  const handleNewFolder = useCallback(async () => {
    const name = window.prompt('Folder name:');
    if (!name?.trim()) return;
    await createFolder({ name: name.trim(), parentId: currentFolderId });
    queryClient.invalidateQueries({ queryKey: ['files', currentFolderId] });
  }, [currentFolderId, queryClient]);

  const handleDelete = useCallback(
    async (file: FileItem) => {
      await deleteFile(file._id);
      queryClient.invalidateQueries({ queryKey: ['files', currentFolderId] });
    },
    [currentFolderId, queryClient],
  );

  const handleDownload = useCallback(async (file: FileItem) => {
    await downloadFile(file._id, file.name);
  }, []);

  const handleSectionNavigate = useCallback((s: string) => {
    if (s === 'drive') {
      setSection('drive');
      setBreadcrumbs([{ id: null, name: 'My Drive' }]);
      navigate('/');
    } else if (s === 'starred') {
      navigate('/starred');
    } else if (s === 'search') {
      navigate('/search');
    } else if (s === 'trash') {
      navigate('/trash');
    }
  }, [navigate]);

  return (
    <div className="drive-shell">
      <Sidebar currentSection={section} onNavigate={handleSectionNavigate} />

      <div className="drive-main">
        <header className="drive-header">
          <Breadcrumbs segments={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />
        </header>

        <div className="drive-body">
          <Toolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onNewFolder={handleNewFolder}
            onUpload={uploadFiles}
            currentFolderId={currentFolderId}
          />

          <UploadZone
            folderId={currentFolderId}
            onDrop={uploadFiles}
          >
            {isLoading ? (
              <div className="drive-loading" aria-label="Loading files" />
            ) : viewMode === 'grid' ? (
              <FileGrid
                files={files}
                onOpen={handleOpenFile}
                onContextMenu={handleContextMenu}
              />
            ) : (
              <FileRow
                files={files}
                onOpen={handleOpenFile}
                onContextMenu={handleContextMenu}
              />
            )}
          </UploadZone>
        </div>

        {uploads.length > 0 && <UploadProgress uploads={uploads} />}
      </div>

      {ctxMenu && (
        <ContextMenu
          file={ctxMenu.file}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onDelete={() => {
            handleDelete(ctxMenu.file);
            setCtxMenu(null);
          }}
          onDownload={() => {
            handleDownload(ctxMenu.file);
            setCtxMenu(null);
          }}
          onMove={() => {
            setMoveFile(ctxMenu.file);
            setCtxMenu(null);
          }}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['files', currentFolderId] });
            setCtxMenu(null);
          }}
        />
      )}

      {previewFile && (
        <PreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {moveFile && (
        <MoveDialog
          file={moveFile}
          onClose={() => setMoveFile(null)}
          onMoved={() => {
            queryClient.invalidateQueries({ queryKey: ['files', currentFolderId] });
            setMoveFile(null);
          }}
        />
      )}
    </div>
  );
}

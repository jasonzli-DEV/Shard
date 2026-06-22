import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import { FolderIcon, FileIcon, formatSize, formatDate } from '../components/FileIcons';
import { listTrash, restoreFile, purgeFile } from '../api/files';
import type { FileItem } from '../api/files';
import './Drive.css';
import './Trash.css';

export default function Trash() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: listTrash,
  });

  const handleSectionNavigate = useCallback(
    (section: string) => {
      if (section === 'drive') navigate('/');
      else if (section === 'starred') navigate('/starred');
      else if (section === 'search') navigate('/search');
      else if (section === 'dashboard') navigate('/dashboard');
      else if (section === 'settings') navigate('/settings');
    },
    [navigate],
  );

  const handleRestore = useCallback(
    async (file: FileItem) => {
      await restoreFile(file._id);
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
    [queryClient],
  );

  const handlePurge = useCallback(
    async (file: FileItem) => {
      if (!window.confirm(`Permanently delete "${file.name}"? This cannot be undone.`)) return;
      await purgeFile(file._id);
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
    [queryClient],
  );

  return (
    <div className="drive-shell">
      <Sidebar currentSection="trash" onNavigate={handleSectionNavigate} />

      <div className="drive-main">
        <header className="drive-header">
          <h1 className="trash-heading">Trash</h1>
        </header>

        <div className="drive-body">
          {isLoading ? (
            <div className="drive-loading" aria-label="Loading trash" />
          ) : files.length === 0 ? (
            <div className="trash-empty">
              <p>Trash is empty.</p>
            </div>
          ) : (
            <table className="trash-table">
              <thead>
                <tr className="trash-header-row">
                  <th className="trash-th trash-th-name">Name</th>
                  <th className="trash-th">Deleted</th>
                  <th className="trash-th trash-th-size">Size</th>
                  <th className="trash-th trash-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file._id} className="trash-row" data-testid={`trash-row-${file._id}`}>
                    <td className="trash-td trash-td-name">
                      <span className="trash-icon">
                        {file.type === 'folder' ? (
                          <FolderIcon size={18} />
                        ) : (
                          <FileIcon size={18} mimeType={file.mimeType} />
                        )}
                      </span>
                      <span className="trash-name truncate">{file.name}</span>
                    </td>
                    <td className="trash-td trash-td-date font-mono">
                      {file.deletedAt ? formatDate(file.deletedAt) : '—'}
                    </td>
                    <td className="trash-td trash-td-size font-mono">
                      {file.type === 'folder' ? '—' : formatSize(file.size)}
                    </td>
                    <td className="trash-td trash-td-actions">
                      <button
                        className="trash-btn trash-btn-restore"
                        onClick={() => handleRestore(file)}
                        type="button"
                        aria-label={`Restore ${file.name}`}
                      >
                        Restore
                      </button>
                      <button
                        className="trash-btn trash-btn-purge"
                        onClick={() => handlePurge(file)}
                        type="button"
                        aria-label={`Permanently delete ${file.name}`}
                      >
                        Delete permanently
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

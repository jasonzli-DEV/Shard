import React from 'react';
import type { FileItem } from '../api/files';
import { FolderIcon, FileIcon, StarIcon, formatSize } from './FileIcons';
import './FileGrid.css';

interface FileGridProps {
  files: FileItem[];
  onOpen: (file: FileItem) => void;
  onContextMenu: (file: FileItem, event: React.MouseEvent) => void;
}

export default function FileGrid({ files, onOpen, onContextMenu }: FileGridProps) {
  if (files.length === 0) {
    return (
      <div className="file-grid-empty" data-testid="file-grid-empty">
        <p>This folder is empty.</p>
        <p className="text-muted">Upload files or create a folder to get started.</p>
      </div>
    );
  }

  return (
    <ul className="file-grid" role="list" data-testid="file-grid">
      {files.map((file) => (
        <li key={file._id} className="file-grid-item">
          <button
            className={`file-grid-card ${file.starred ? 'starred' : ''}`}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(file, e);
            }}
            data-testid={`file-card-${file._id}`}
            aria-label={`${file.type === 'folder' ? 'Folder' : 'File'}: ${file.name}`}
            type="button"
          >
            <div className="file-grid-icon">
              {file.type === 'folder' ? (
                <FolderIcon size={32} />
              ) : (
                <FileIcon size={32} mimeType={file.mimeType} />
              )}
              {file.starred && (
                <span className="file-grid-star">
                  <StarIcon size={10} filled />
                </span>
              )}
            </div>
            <span className="file-grid-name truncate">{file.name}</span>
            {file.size != null && (
              <span className="file-grid-size font-mono">{formatSize(file.size)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

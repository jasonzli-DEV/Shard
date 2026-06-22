import React from 'react';
import type { FileItem } from '../api/files';
import { FolderIcon, FileIcon, StarIcon, formatSize, formatDate } from './FileIcons';
import './FileRow.css';

interface FileRowProps {
  files: FileItem[];
  onOpen: (file: FileItem) => void;
  onContextMenu: (file: FileItem, event: React.MouseEvent) => void;
}

export default function FileRow({ files, onOpen, onContextMenu }: FileRowProps) {
  if (files.length === 0) {
    return (
      <div className="file-row-empty" data-testid="file-row-empty">
        <p>This folder is empty.</p>
      </div>
    );
  }

  return (
    <table className="file-row-table" data-testid="file-list">
      <thead>
        <tr className="file-row-header">
          <th className="file-row-th file-row-th-name">Name</th>
          <th className="file-row-th">Modified</th>
          <th className="file-row-th file-row-th-size">Size</th>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr
            key={file._id}
            className={`file-row ${file.starred ? 'starred' : ''}`}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(file, e);
            }}
            data-testid={`file-row-${file._id}`}
            aria-label={`${file.type === 'folder' ? 'Folder' : 'File'}: ${file.name}`}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}
          >
            <td className="file-row-td file-row-td-name">
              <span className="file-row-icon">
                {file.type === 'folder' ? (
                  <FolderIcon size={18} />
                ) : (
                  <FileIcon size={18} mimeType={file.mimeType} />
                )}
              </span>
              <span className="file-row-name truncate">{file.name}</span>
              {file.starred && (
                <span className="file-row-star">
                  <StarIcon size={12} filled />
                </span>
              )}
            </td>
            <td className="file-row-td file-row-td-date font-mono">
              {formatDate(file.updatedAt)}
            </td>
            <td className="file-row-td file-row-td-size font-mono">
              {file.type === 'folder' ? '—' : formatSize(file.size)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import { listSharedWithMe } from '../api/files';
import type { SharedWithMeItem } from '../api/files';
import './Drive.css';
import './SharedWithMe.css';

export default function SharedWithMe() {
  const navigate = useNavigate();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: listSharedWithMe,
  });

  const handleSectionNavigate = useCallback(
    (section: string) => {
      if (section === 'drive') navigate('/');
      else if (section === 'starred') navigate('/starred');
      else if (section === 'search') navigate('/search');
      else if (section === 'trash') navigate('/trash');
    },
    [navigate],
  );

  return (
    <div className="drive-shell">
      <Sidebar currentSection="shared" onNavigate={handleSectionNavigate} />

      <div className="drive-main">
        <header className="drive-header shared-header">
          <h1 className="shared-heading">Shared with me</h1>
        </header>

        <div className="drive-body">
          {isLoading ? (
            <div className="drive-loading" aria-label="Loading shared files" />
          ) : items.length === 0 ? (
            <div className="shared-empty">
              <p>Nothing shared with you yet.</p>
              <p className="shared-empty-hint">
                When someone shares a file or folder with you, it will appear here.
              </p>
            </div>
          ) : (
            <ul className="shared-list" aria-label="Shared files">
              {items.map((item) => (
                <SharedRow key={item._id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SharedRow({ item }: { item: SharedWithMeItem }) {
  const isFolder = item.file.type === 'folder';

  return (
    <li className="shared-row" data-testid={`shared-row-${item._id}`}>
      <span className="shared-row-icon" aria-hidden="true">
        {isFolder ? <FolderIcon /> : <FileIcon />}
      </span>
      <div className="shared-row-info">
        <span className="shared-row-name">{item.file.name}</span>
        <span className="shared-row-meta">
          Shared by {item.owner.name}
          {item.owner.email ? ` (${item.owner.email})` : ''}
        </span>
      </div>
      <span className={`shared-permission-badge shared-permission-badge--${item.permission}`}>
        {item.permission}
      </span>
      <span className="shared-row-date">
        {new Date(item.createdAt).toLocaleDateString()}
      </span>
    </li>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#4A90D9" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" opacity="0.8" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

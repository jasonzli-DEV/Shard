import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import FileRow from '../components/FileRow';
import { searchFiles } from '../api/files';
import type { FileItem } from '../api/files';
import './Drive.css';
import './Search.css';

export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['search', submittedQuery],
    queryFn: () => searchFiles(submittedQuery),
    enabled: submittedQuery.trim().length > 0,
  });

  const handleSectionNavigate = useCallback(
    (section: string) => {
      if (section === 'drive') navigate('/');
      else if (section === 'trash') navigate('/trash');
      else if (section === 'starred') navigate('/starred');
    },
    [navigate],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) setSubmittedQuery(trimmed);
    },
    [query],
  );

  const handleOpenFile = useCallback(
    (file: FileItem) => {
      if (file.type === 'folder') {
        navigate(`/folder/${file._id}`);
      }
    },
    [navigate],
  );

  const handleContextMenu = useCallback((_file: FileItem, _event: React.MouseEvent) => {}, []);

  const hasQuery = submittedQuery.trim().length > 0;

  return (
    <div className="drive-shell">
      <Sidebar currentSection="search" onNavigate={handleSectionNavigate} />

      <div className="drive-main">
        <header className="drive-header">
          <h1 className="search-heading">Search</h1>
        </header>

        <div className="drive-body">
          <form className="search-form" onSubmit={handleSubmit} role="search">
            <input
              className="search-input"
              type="search"
              placeholder="Search files and folders…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search query"
              autoFocus
            />
            <button className="search-submit" type="submit">
              Search
            </button>
          </form>

          {!hasQuery ? (
            <div className="search-empty">
              <p>Type to search your files.</p>
            </div>
          ) : isLoading ? (
            <div className="drive-loading" aria-label="Searching" />
          ) : results.length === 0 ? (
            <div className="search-empty">
              <p>No results for &ldquo;{submittedQuery}&rdquo;.</p>
            </div>
          ) : (
            <>
              <p className="search-result-count">
                {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{submittedQuery}&rdquo;
              </p>
              <FileRow
                files={results}
                onOpen={handleOpenFile}
                onContextMenu={handleContextMenu}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

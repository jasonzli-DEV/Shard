/**
 * Task 7.6 — Trash page tests.
 * Renders trashed files from mocked listTrash(), tests Restore action.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', name: 'Test User', email: 'test@x.com', role: 'admin', encryptionEnabled: false },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockListTrash = vi.fn();
const mockRestoreFile = vi.fn();
const mockPurgeFile = vi.fn();

vi.mock('../api/files', () => ({
  listTrash: (...args: unknown[]) => mockListTrash(...args),
  restoreFile: (...args: unknown[]) => mockRestoreFile(...args),
  purgeFile: (...args: unknown[]) => mockPurgeFile(...args),
  listFiles: vi.fn().mockResolvedValue([]),
  searchFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock('../hooks/useUpload', () => ({
  useUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));

import Trash from '../pages/Trash';

const TRASHED_FILES = [
  {
    _id: 't1',
    name: 'deleted-doc.pdf',
    type: 'file' as const,
    mimeType: 'application/pdf',
    size: 51200,
    starred: false,
    deleted: true,
    deletedAt: '2024-06-01T10:00:00Z',
    parentId: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-06-01',
    path: '/deleted-doc.pdf',
    encrypted: false,
  },
  {
    _id: 't2',
    name: 'old-folder',
    type: 'folder' as const,
    starred: false,
    deleted: true,
    deletedAt: '2024-06-02T10:00:00Z',
    parentId: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-06-02',
    path: '/old-folder',
    encrypted: false,
  },
];

function renderTrash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/trash']}>
        <Routes>
          <Route path="/trash" element={<Trash />} />
          <Route path="/" element={<div>Drive</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Trash page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTrash.mockResolvedValue(TRASHED_FILES);
    mockRestoreFile.mockResolvedValue(TRASHED_FILES[0]);
    mockPurgeFile.mockResolvedValue(undefined);
  });

  it('renders trash items from mocked listTrash()', async () => {
    renderTrash();

    const docRow = await screen.findByText('deleted-doc.pdf');
    expect(docRow).toBeInTheDocument();

    const folderRow = await screen.findByText('old-folder');
    expect(folderRow).toBeInTheDocument();
  });

  it('shows empty state when trash is empty', async () => {
    mockListTrash.mockResolvedValue([]);
    renderTrash();

    const empty = await screen.findByText('Trash is empty.');
    expect(empty).toBeInTheDocument();
  });

  it('clicking Restore calls restoreFile() with correct fileId', async () => {
    renderTrash();

    // Wait for rows to appear
    await screen.findByText('deleted-doc.pdf');

    // Find the Restore button for the first file (t1)
    const restoreBtn = screen.getAllByRole('button', { name: /restore/i })[0];
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(mockRestoreFile).toHaveBeenCalledWith('t1');
    });
  });

  it('shows Restore and Delete permanently buttons for each file', async () => {
    renderTrash();

    await screen.findByText('deleted-doc.pdf');

    const restoreBtns = screen.getAllByRole('button', { name: /restore/i });
    expect(restoreBtns).toHaveLength(2);

    const purgeBtns = screen.getAllByRole('button', { name: /permanently delete/i });
    expect(purgeBtns).toHaveLength(2);
  });
});

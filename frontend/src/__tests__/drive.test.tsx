/**
 * Task 7.3 — Drive page tests.
 * Renders mocked files, folder click navigates.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';

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

vi.mock('../api/files', () => ({
  listFiles: vi.fn().mockResolvedValue([
    { _id: 'f1', name: 'Documents', type: 'folder', starred: false, deleted: false, parentId: null, createdAt: '2024-01-01', updatedAt: '2024-01-01', path: '/Documents', encrypted: false },
    { _id: 'f2', name: 'photo.jpg', type: 'file', mimeType: 'image/jpeg', size: 204800, starred: false, deleted: false, parentId: null, createdAt: '2024-01-01', updatedAt: '2024-01-01', path: '/photo.jpg', encrypted: false },
  ]),
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('../hooks/useUpload', () => ({
  useUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));

import Drive from '../pages/Drive';

function renderDrive(path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Drive />} />
          <Route path="/folder/:folderId" element={<Drive />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Drive page', () => {
  it('renders files from the mocked API', async () => {
    renderDrive();

    // Wait for the folder name to appear
    const docCard = await screen.findByText('Documents');
    expect(docCard).toBeInTheDocument();

    const photoCard = await screen.findByText('photo.jpg');
    expect(photoCard).toBeInTheDocument();
  });

  it('shows the grid view by default', async () => {
    renderDrive();
    await screen.findByText('Documents');
    expect(screen.getByTestId('file-grid')).toBeInTheDocument();
  });

  it('switches to list view when list button is toggled', async () => {
    renderDrive();
    await screen.findByText('Documents');

    const listBtn = screen.getByTitle('List view');
    fireEvent.click(listBtn);

    expect(screen.getByTestId('file-list')).toBeInTheDocument();
  });

  it('navigates into a folder on double-click', async () => {
    renderDrive();
    const folderCard = await screen.findByTestId('file-card-f1');
    fireEvent.dblClick(folderCard);

    // Should show the folder name in breadcrumbs
    expect(await screen.findByText('Documents')).toBeInTheDocument();
  });
});

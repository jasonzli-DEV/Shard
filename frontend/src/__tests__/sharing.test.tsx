/**
 * Task 7.7 — Sharing tests.
 * Tests: ShareDialog posts share on submit; PublicFile renders metadata from slug.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Auth mock ────────────────────────────────────────────────────────────────
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', name: 'Test User', email: 'test@x.com', role: 'admin', encryptionEnabled: false },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── API mocks ────────────────────────────────────────────────────────────────
const mockCreateShare = vi.fn();
const mockListShares = vi.fn();
const mockRemoveShare = vi.fn();
const mockGetPublicFile = vi.fn();
const mockGetPublicDownloadUrl = vi.fn((slug: string) => `/api/public/${slug}/download`);

vi.mock('../api/files', () => ({
  createShare: (...args: unknown[]) => mockCreateShare(...args),
  listShares: (...args: unknown[]) => mockListShares(...args),
  removeShare: (...args: unknown[]) => mockRemoveShare(...args),
  getPublicFile: (...args: unknown[]) => mockGetPublicFile(...args),
  getPublicDownloadUrl: (slug: string) => mockGetPublicDownloadUrl(slug),
  listFiles: vi.fn().mockResolvedValue([]),
}));

import ShareDialog from '../components/ShareDialog';
import PublicFile from '../pages/PublicFile';
import type { FileItem } from '../api/files';

const MOCK_FILE: FileItem = {
  _id: 'file1',
  name: 'report.pdf',
  type: 'file',
  mimeType: 'application/pdf',
  size: 102400,
  starred: false,
  deleted: false,
  parentId: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  path: '/report.pdf',
  encrypted: false,
};

function renderShareDialog(onClose = vi.fn(), onChanged = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ShareDialog file={MOCK_FILE} onClose={onClose} onChanged={onChanged} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPublicFile(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/p/${slug}`]}>
        <Routes>
          <Route path="/p/:slug" element={<PublicFile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListShares.mockResolvedValue([]);
    mockCreateShare.mockResolvedValue({
      _id: 'share1',
      fileId: 'file1',
      sharedWithId: 'u2',
      sharedWithEmail: 'colleague@example.com',
      permission: 'view',
      createdAt: '2024-01-01T00:00:00Z',
    });
  });

  it('renders the share dialog with file name', async () => {
    renderShareDialog();
    expect(await screen.findByTestId('share-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Share: report\.pdf/i)).toBeInTheDocument();
  });

  it('posts share on submit with correct args', async () => {
    renderShareDialog();

    // Wait for dialog to render
    await screen.findByTestId('share-dialog');

    // Fill in email
    const emailInput = screen.getByLabelText(/email address to share with/i);
    fireEvent.change(emailInput, { target: { value: 'colleague@example.com' } });

    // Permission is "view" by default
    const permissionSelect = screen.getByLabelText(/permission level/i);
    expect((permissionSelect as HTMLSelectElement).value).toBe('view');

    // Click Share
    const shareBtn = screen.getByRole('button', { name: /^share$/i });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(mockCreateShare).toHaveBeenCalledWith(
        'file1',
        'colleague@example.com',
        'view',
      );
    });
  });

  it('can select "edit" permission before sharing', async () => {
    renderShareDialog();
    await screen.findByTestId('share-dialog');

    const emailInput = screen.getByLabelText(/email address to share with/i);
    fireEvent.change(emailInput, { target: { value: 'editor@example.com' } });

    const permissionSelect = screen.getByLabelText(/permission level/i);
    fireEvent.change(permissionSelect, { target: { value: 'edit' } });

    const shareBtn = screen.getByRole('button', { name: /^share$/i });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(mockCreateShare).toHaveBeenCalledWith('file1', 'editor@example.com', 'edit');
    });
  });

  it('shows existing shares from the API', async () => {
    mockListShares.mockResolvedValue([
      {
        _id: 'share1',
        fileId: 'file1',
        sharedWithId: 'u2',
        sharedWithEmail: 'alice@example.com',
        sharedWithName: 'Alice',
        permission: 'view',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);

    renderShareDialog();

    const aliceEmail = await screen.findByText('alice@example.com');
    expect(aliceEmail).toBeInTheDocument();
  });
});

describe('PublicFile page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders file metadata from mocked slug fetch', async () => {
    mockGetPublicFile.mockResolvedValue({
      _id: 'file1',
      name: 'public-report.pdf',
      path: '/public-report.pdf',
      type: 'file',
      mimeType: 'application/pdf',
      size: 204800,
      createdAt: '2024-03-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z',
    });

    renderPublicFile('abc123');

    const filename = await screen.findByTestId('pubfile-name');
    expect(filename).toHaveTextContent('public-report.pdf');

    const card = screen.getByTestId('pubfile-card');
    expect(card).toBeInTheDocument();
  });

  it('shows download link with correct href', async () => {
    mockGetPublicFile.mockResolvedValue({
      _id: 'file1',
      name: 'report.pdf',
      path: '/report.pdf',
      type: 'file',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    renderPublicFile('myslug');

    const downloadLink = await screen.findByTestId('pubfile-download');
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute('href', '/api/public/myslug/download');
  });

  it('shows expired/not found message on 404', async () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    mockGetPublicFile.mockRejectedValue(err);

    renderPublicFile('dead-slug');

    const notFound = await screen.findByTestId('pubfile-not-found');
    expect(notFound).toBeInTheDocument();
    expect(screen.getByText(/This link has expired or does not exist/i)).toBeInTheDocument();
  });

  it('shows expired message on 410', async () => {
    const err = Object.assign(new Error('Gone'), { status: 410 });
    mockGetPublicFile.mockRejectedValue(err);

    renderPublicFile('expired-slug');

    const notFound = await screen.findByTestId('pubfile-not-found');
    expect(notFound).toBeInTheDocument();
  });
});

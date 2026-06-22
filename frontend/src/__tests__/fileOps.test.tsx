/**
 * Task 7.5 — File operations tests.
 * Rename triggers PATCH; preview opens for an image.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockUpdateFile = vi.fn().mockResolvedValue({});
const mockListFiles = vi.fn().mockResolvedValue([]);

vi.mock('../api/files', () => ({
  updateFile: (...args: unknown[]) => mockUpdateFile(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
  getDownloadUrl: (id: string) => `/api/files/${id}/download`,
}));

import ContextMenu from '../components/ContextMenu';
import PreviewModal from '../components/PreviewModal';
import type { FileItem } from '../api/files';

const mockFile: FileItem = {
  _id: 'abc123',
  name: 'report.pdf',
  type: 'file',
  mimeType: 'application/pdf',
  size: 102400,
  parentId: null,
  starred: false,
  deleted: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  path: '/report.pdf',
  encrypted: false,
};

const mockImageFile: FileItem = {
  ...mockFile,
  _id: 'img1',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
};

describe('ContextMenu', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const defaultProps = {
    file: mockFile,
    x: 100,
    y: 100,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onMove: vi.fn(),
    onRefresh: vi.fn(),
  };

  function renderMenu(props = defaultProps) {
    return render(
      <QueryClientProvider client={qc}>
        <ContextMenu {...props} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockUpdateFile.mockClear();
    defaultProps.onClose.mockClear();
    defaultProps.onRefresh.mockClear();
  });

  it('renders the context menu', () => {
    renderMenu();
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-delete')).toBeInTheDocument();
  });

  it('clicking Rename shows the rename input', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('ctx-rename'));
    expect(screen.getByRole('textbox', { name: /new name/i })).toBeInTheDocument();
  });

  it('submitting a rename calls updateFile with the new name', async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('ctx-rename'));

    const input = screen.getByRole('textbox', { name: /new name/i });
    fireEvent.change(input, { target: { value: 'report-v2.pdf' } });
    fireEvent.click(screen.getByText('Rename'));

    await waitFor(() => {
      expect(mockUpdateFile).toHaveBeenCalledWith('abc123', { name: 'report-v2.pdf' });
    });
  });

  it('pressing Enter in rename input triggers rename', async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('ctx-rename'));

    const input = screen.getByRole('textbox', { name: /new name/i });
    fireEvent.change(input, { target: { value: 'new-name.pdf' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockUpdateFile).toHaveBeenCalledWith('abc123', { name: 'new-name.pdf' });
    });
  });

  it('calls onMove when "Move to…" is clicked', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('ctx-move'));
    expect(defaultProps.onMove).toHaveBeenCalled();
  });

  it('calls onDelete when "Move to trash" is clicked', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('ctx-delete'));
    expect(defaultProps.onDelete).toHaveBeenCalled();
  });
});

describe('PreviewModal', () => {
  it('opens for an image file', () => {
    render(
      <PreviewModal
        file={mockImageFile}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('preview-modal')).toBeInTheDocument();
    expect(screen.getByTestId('preview-image')).toBeInTheDocument();
  });

  it('shows the correct filename', () => {
    render(<PreviewModal file={mockImageFile} onClose={vi.fn()} />);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<PreviewModal file={mockImageFile} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows PDF preview for pdf files', () => {
    render(<PreviewModal file={mockFile} onClose={vi.fn()} />);
    expect(screen.getByTestId('preview-pdf')).toBeInTheDocument();
  });

  it('shows unsupported for unknown mime types', () => {
    const binFile = { ...mockFile, mimeType: 'application/octet-stream' };
    render(<PreviewModal file={binFile} onClose={vi.fn()} />);
    expect(screen.getByTestId('preview-unsupported')).toBeInTheDocument();
  });
});

describe('MoveDialog', () => {
  it('renders the dialog', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { default: MoveDialog } = await import('../components/MoveDialog');

    render(
      <QueryClientProvider client={qc}>
        <MoveDialog file={mockFile} onClose={vi.fn()} onMoved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('move-dialog')).toBeInTheDocument();
  });
});

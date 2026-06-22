/**
 * Task 7.4 — Upload tests.
 * Dropping a file calls upload API; progress renders.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockUploadFile = vi.fn().mockResolvedValue({
  _id: 'new-file-id',
  name: 'test.txt',
  type: 'file',
});

vi.mock('../api/files', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  listFiles: vi.fn().mockResolvedValue([]),
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
}));

import UploadZone from '../components/UploadZone';
import UploadProgress from '../components/UploadProgress';
import { useUpload } from '../hooks/useUpload';

// Wrapper that uses the hook
function UploadHookHarness({ folderId }: { folderId: string | null }) {
  const { uploads, uploadFiles } = useUpload(folderId, vi.fn());

  return (
    <div>
      <UploadZone folderId={folderId} onDrop={uploadFiles}>
        <div data-testid="drop-target">Drop here</div>
      </UploadZone>
      <UploadProgress uploads={uploads} />
    </div>
  );
}

describe('UploadZone', () => {
  it('calls onDrop when files are dropped', () => {
    const onDrop = vi.fn();
    render(
      <UploadZone folderId={null} onDrop={onDrop}>
        <div>Drop area</div>
      </UploadZone>,
    );

    const zone = screen.getByTestId('upload-zone');
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const dataTransfer = {
      files: [file],
      items: [],
      types: ['Files'],
      dropEffect: 'copy' as DataTransfer['dropEffect'],
      effectAllowed: 'all' as DataTransfer['effectAllowed'],
      clearData: vi.fn(),
      getData: vi.fn(),
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };

    fireEvent.drop(zone, { dataTransfer });
    expect(onDrop).toHaveBeenCalledWith([file]);
  });

  it('shows drag overlay while dragging', () => {
    render(
      <UploadZone folderId={null} onDrop={vi.fn()}>
        <div>content</div>
      </UploadZone>,
    );

    const zone = screen.getByTestId('upload-zone');
    fireEvent.dragEnter(zone);
    expect(screen.getByText('Drop files to upload')).toBeInTheDocument();

    fireEvent.dragLeave(zone);
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
  });
});

describe('UploadProgress', () => {
  it('renders progress bar for uploading items', () => {
    const items = [
      { id: '1', name: 'file.txt', status: 'uploading' as const, progress: 40 },
    ];
    render(<UploadProgress uploads={items} />);
    expect(screen.getByTestId('upload-progress')).toBeInTheDocument();
    expect(screen.getByText('file.txt')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('shows nothing when uploads list is empty', () => {
    render(<UploadProgress uploads={[]} />);
    expect(screen.queryByTestId('upload-progress')).not.toBeInTheDocument();
  });
});

describe('useUpload hook', () => {
  it('calls uploadFile API when files are dropped', async () => {
    render(<UploadHookHarness folderId={null} />);

    const zone = screen.getByTestId('upload-zone');
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });
    const dataTransfer = {
      files: [file],
      items: [],
      types: ['Files'],
      dropEffect: 'copy' as DataTransfer['dropEffect'],
      effectAllowed: 'all' as DataTransfer['effectAllowed'],
      clearData: vi.fn(),
      getData: vi.fn(),
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };

    fireEvent.drop(zone, { dataTransfer });

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file, null, expect.any(Function));
    });
  });
});

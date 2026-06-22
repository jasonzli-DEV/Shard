/**
 * Task 8.2 — Setup wizard component tests.
 *
 * Tests cover:
 *   - 4-step navigation flow
 *   - test-connection gate (Next disabled until connection verified)
 *   - step 2 validation (at least one provider required, both fields required)
 *   - step 3 validation (URL required)
 *   - step 4 configure call + success state
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock react-router-dom navigate ────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── Mock setup API ────────────────────────────────────────────────────────────
const mockTestConnection = vi.fn();
const mockConfigure = vi.fn();

vi.mock('../api/setup', () => ({
  testConnection: (...args: unknown[]) => mockTestConnection(...args),
  configure: (...args: unknown[]) => mockConfigure(...args),
}));

import Setup from '../pages/Setup';

function renderSetup() {
  return render(
    <MemoryRouter>
      <Setup />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Step 1: Starter cluster ───────────────────────────────────────────────────

describe('Setup wizard — Step 1 (Starter cluster)', () => {
  it('renders the step 1 heading', () => {
    renderSetup();
    expect(
      screen.getByRole('heading', { name: /connect your starter cluster/i }),
    ).toBeInTheDocument();
  });

  it('shows the stepper with 4 steps', () => {
    renderSetup();
    // The stepper renders step labels
    expect(screen.getByText('Starter cluster')).toBeInTheDocument();
    expect(screen.getByText('OAuth providers')).toBeInTheDocument();
    expect(screen.getByText('Site config')).toBeInTheDocument();
    expect(screen.getByText('Finish')).toBeInTheDocument();
  });

  it('Next button is disabled until connection is tested', () => {
    renderSetup();
    const nextBtn = screen.getByRole('button', {
      name: /next: oauth providers/i,
    });
    expect(nextBtn).toBeDisabled();
  });

  it('Test connection button calls the API', async () => {
    mockTestConnection.mockResolvedValueOnce({ ok: false, error: 'refused' });
    renderSetup();

    const input = screen.getByTestId('input-starter-uri');
    const testBtn = screen.getByTestId('btn-test-connection');

    fireEvent.change(input, {
      target: { value: 'mongodb://localhost:27017/shard' },
    });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(mockTestConnection).toHaveBeenCalledWith(
        'mongodb://localhost:27017/shard',
      );
    });
  });

  it('shows error when test fails', async () => {
    mockTestConnection.mockResolvedValueOnce({
      ok: false,
      error: 'Connection refused',
    });
    renderSetup();

    const input = screen.getByTestId('input-starter-uri');
    fireEvent.change(input, { target: { value: 'mongodb://bad:27017/x' } });
    fireEvent.click(screen.getByTestId('btn-test-connection'));

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });

  it('enables Next after successful test', async () => {
    mockTestConnection.mockResolvedValueOnce({ ok: true });
    renderSetup();

    const input = screen.getByTestId('input-starter-uri');
    fireEvent.change(input, {
      target: { value: 'mongodb+srv://user:pass@cluster.mongodb.net/shard' },
    });
    fireEvent.click(screen.getByTestId('btn-test-connection'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /next: oauth providers/i }),
      ).not.toBeDisabled();
    });
  });
});

// ── Step 2: OAuth providers ───────────────────────────────────────────────────

async function advanceToStep2() {
  mockTestConnection.mockResolvedValueOnce({ ok: true });
  renderSetup();

  const input = screen.getByTestId('input-starter-uri');
  fireEvent.change(input, {
    target: { value: 'mongodb+srv://u:p@cluster.mongodb.net/shard' },
  });
  fireEvent.click(screen.getByTestId('btn-test-connection'));

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: /next: oauth providers/i }),
    ).not.toBeDisabled();
  });

  fireEvent.click(screen.getByRole('button', { name: /next: oauth providers/i }));
}

describe('Setup wizard — Step 2 (OAuth)', () => {
  it('renders the OAuth step heading', async () => {
    await advanceToStep2();
    expect(
      screen.getByRole('heading', { name: /sign-in providers/i }),
    ).toBeInTheDocument();
  });

  it('Next is disabled when no provider enabled', async () => {
    await advanceToStep2();
    expect(
      screen.getByRole('button', { name: /next: site config/i }),
    ).toBeDisabled();
  });

  it('enabling Google shows its fields', async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByTestId('toggle-google'));
    expect(screen.getByTestId('input-google-client-id')).toBeInTheDocument();
    expect(
      screen.getByTestId('input-google-client-secret'),
    ).toBeInTheDocument();
  });

  it('Next is disabled when Google enabled but fields empty', async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByTestId('toggle-google'));
    expect(
      screen.getByRole('button', { name: /next: site config/i }),
    ).toBeDisabled();
  });

  it('Next enables when Google creds filled', async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByTestId('toggle-google'));

    fireEvent.change(screen.getByTestId('input-google-client-id'), {
      target: { value: 'gid' },
    });
    fireEvent.change(screen.getByTestId('input-google-client-secret'), {
      target: { value: 'gsecret' },
    });

    expect(
      screen.getByRole('button', { name: /next: site config/i }),
    ).not.toBeDisabled();
  });

  it('enabling GitHub shows its fields', async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByTestId('toggle-github'));
    expect(screen.getByTestId('input-github-client-id')).toBeInTheDocument();
  });

  it('can go back to step 1', async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByRole('button', { name: /← back/i }));
    expect(
      screen.getByRole('heading', { name: /connect your starter cluster/i }),
    ).toBeInTheDocument();
  });
});

// ── Step 3: Site config ───────────────────────────────────────────────────────

async function advanceToStep3() {
  await advanceToStep2();
  fireEvent.click(screen.getByTestId('toggle-google'));
  fireEvent.change(screen.getByTestId('input-google-client-id'), {
    target: { value: 'gid' },
  });
  fireEvent.change(screen.getByTestId('input-google-client-secret'), {
    target: { value: 'gsecret' },
  });
  fireEvent.click(screen.getByRole('button', { name: /next: site config/i }));
}

describe('Setup wizard — Step 3 (Site config)', () => {
  it('renders the site config heading', async () => {
    await advanceToStep3();
    expect(
      screen.getByRole('heading', { name: /site configuration/i }),
    ).toBeInTheDocument();
  });

  it('Next is disabled until URL filled', async () => {
    await advanceToStep3();
    expect(
      screen.getByRole('button', { name: /next: review/i }),
    ).toBeDisabled();
  });

  it('Next enables when URL and origins filled', async () => {
    await advanceToStep3();
    fireEvent.change(screen.getByTestId('input-public-url'), {
      target: { value: 'https://shard.example.com' },
    });
    fireEvent.change(screen.getByTestId('input-allowed-origins'), {
      target: { value: 'https://shard.example.com' },
    });
    expect(
      screen.getByRole('button', { name: /next: review/i }),
    ).not.toBeDisabled();
  });
});

// ── Step 4: Finish ────────────────────────────────────────────────────────────

async function advanceToStep4() {
  await advanceToStep3();
  fireEvent.change(screen.getByTestId('input-public-url'), {
    target: { value: 'https://shard.example.com' },
  });
  fireEvent.change(screen.getByTestId('input-allowed-origins'), {
    target: { value: 'https://shard.example.com' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: /next: review & apply/i }),
  );
}

describe('Setup wizard — Step 4 (Finish)', () => {
  it('renders the review heading', async () => {
    await advanceToStep4();
    expect(
      screen.getByRole('heading', { name: /review and apply/i }),
    ).toBeInTheDocument();
  });

  it('shows the review table', async () => {
    await advanceToStep4();
    // There are multiple elements with "google" (stepper sublabel + review row)
    // so use getAllByText and just assert at least one matches
    expect(screen.getByText(/starter uri/i)).toBeInTheDocument();
    expect(screen.getAllByText(/google/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/public url/i)).toBeInTheDocument();
  });

  it('calls configure with correct payload on submit', async () => {
    mockConfigure.mockResolvedValueOnce(undefined);
    await advanceToStep4();

    fireEvent.click(screen.getByTestId('btn-configure'));

    await waitFor(() => {
      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          starterUri: 'mongodb+srv://u:p@cluster.mongodb.net/shard',
          google: { clientId: 'gid', clientSecret: 'gsecret' },
          publicUrl: 'https://shard.example.com',
          allowedOrigins: 'https://shard.example.com',
        }),
      );
    });
  });

  it('shows done state after successful configure', async () => {
    mockConfigure.mockResolvedValueOnce(undefined);
    await advanceToStep4();

    fireEvent.click(screen.getByTestId('btn-configure'));

    await waitFor(() => {
      expect(screen.getByTestId('setup-done')).toBeInTheDocument();
    });
  });

  it('navigates to /login after done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockConfigure.mockResolvedValueOnce(undefined);
    await advanceToStep4();

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-configure'));
      // Flush promises so configure resolves
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('setup-done')).toBeInTheDocument();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    vi.useRealTimers();
  });

  it('shows error when configure fails', async () => {
    mockConfigure.mockRejectedValueOnce(new Error('Server error'));
    await advanceToStep4();

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-configure'));
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

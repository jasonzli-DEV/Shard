/**
 * Regression test for the setup-routing bug.
 *
 * `/api/setup/status` returns `{ setupRequired, configured: {...flags} }`.
 * `configured` is an OBJECT (always truthy), so the app must branch on the
 * explicit `setupRequired` flag — not on `configured`. The original bug read
 * `configured` and therefore always showed Login on a fresh, unconfigured
 * instance.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../api/client', () => ({ default: { get: (...a: unknown[]) => mockGet(...a) } }));

// Stub auth so the "done" branch is deterministic (unauthenticated → Login).
vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));

// Stub the lazy pages so we can detect which one renders.
vi.mock('../pages/Setup', () => ({ default: () => <div data-testid="setup">Setup</div> }));
vi.mock('../pages/Login', () => ({ default: () => <div data-testid="login">Login</div> }));
vi.mock('../pages/Drive', () => ({ default: () => <div data-testid="drive">Drive</div> }));
vi.mock('../pages/Trash', () => ({ default: () => <div>Trash</div> }));
vi.mock('../pages/Starred', () => ({ default: () => <div>Starred</div> }));
vi.mock('../pages/Search', () => ({ default: () => <div>Search</div> }));
vi.mock('../pages/SharedWithMe', () => ({ default: () => <div>Shared</div> }));
vi.mock('../pages/PublicFile', () => ({ default: () => <div>Public</div> }));
vi.mock('../pages/Dashboard', () => ({ default: () => <div>Dashboard</div> }));
vi.mock('../pages/Settings', () => ({ default: () => <div>Settings</div> }));

import App from '../App';

describe('setup routing', () => {
  beforeEach(() => mockGet.mockReset());

  it('shows the Setup wizard when setupRequired is true (even though configured is a truthy object)', async () => {
    mockGet.mockResolvedValue({
      data: { setupRequired: true, configured: { starterDb: false, jwt: true, google: false } },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('setup')).toBeInTheDocument());
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });

  it('shows Login (not Setup) once setup is complete', async () => {
    mockGet.mockResolvedValue({
      data: { setupRequired: false, configured: { starterDb: true, jwt: true, google: true } },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(screen.queryByTestId('setup')).not.toBeInTheDocument();
  });
});

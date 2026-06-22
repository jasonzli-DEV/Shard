/**
 * Task 7.1 — Route guard tests.
 *
 * Verifies that:
 *   - unauthenticated users are redirected to /login from protected routes
 *   - authenticated users can access protected routes
 *   - authenticated users are redirected away from /login
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';

// Mock the auth context
const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ProtectedRoute, PublicOnlyRoute } from '../routes';

function DriveStub() {
  return <div data-testid="drive">Drive</div>;
}
function LoginStub() {
  return <div data-testid="login">Login</div>;
}

describe('ProtectedRoute', () => {
  it('redirects to /login when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DriveStub />} />
          </Route>
          <Route path="/login" element={<LoginStub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login')).toBeInTheDocument();
    expect(screen.queryByTestId('drive')).not.toBeInTheDocument();
  });

  it('renders protected content when authenticated', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DriveStub />} />
          </Route>
          <Route path="/login" element={<LoginStub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('drive')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });

  it('shows loading state while auth resolves', () => {
    mockUseAuth.mockReturnValue({ isLoading: true, isAuthenticated: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DriveStub />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(screen.queryByTestId('drive')).not.toBeInTheDocument();
  });
});

describe('PublicOnlyRoute', () => {
  it('renders login when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginStub />} />
          </Route>
          <Route path="/" element={<DriveStub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login')).toBeInTheDocument();
  });

  it('redirects authenticated users from /login to /', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginStub />} />
          </Route>
          <Route path="/" element={<DriveStub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('drive')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });
});

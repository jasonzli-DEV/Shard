/**
 * Task 7.2 — Login page render tests.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// ShardMark uses SVG, no special mocking needed
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: false, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Login from '../pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login page', () => {
  it('renders the Shard wordmark', () => {
    renderLogin();
    expect(screen.getByText('Shard')).toBeInTheDocument();
  });

  it('renders Google sign-in link pointing to /api/auth/google', () => {
    renderLogin();
    const btn = screen.getByTestId('login-google');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('href', '/api/auth/google');
  });

  it('renders GitHub sign-in link pointing to /api/auth/github', () => {
    renderLogin();
    const btn = screen.getByTestId('login-github');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('href', '/api/auth/github');
  });

  it('includes the "Sign in" heading', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });
});

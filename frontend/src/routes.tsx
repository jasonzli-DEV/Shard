import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

/**
 * Shows a skeleton while auth state is resolving — avoids flash-of-login.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();
  if (isLoading) return <div className="auth-loading" aria-label="Loading" />;
  return <>{children}</>;
}

/**
 * Redirects unauthenticated visitors to /login.
 * Redirects authenticated visitors away from /login to /.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="auth-loading" aria-label="Loading" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="auth-loading" aria-label="Loading" />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

export { AuthGate };

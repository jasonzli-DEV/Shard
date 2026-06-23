import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, PublicOnlyRoute } from './routes';
import client from './api/client';
import './styles/theme.css';

const Login = lazy(() => import('./pages/Login'));
const Drive = lazy(() => import('./pages/Drive'));
const Setup = lazy(() => import('./pages/Setup'));
const Trash = lazy(() => import('./pages/Trash'));
const Starred = lazy(() => import('./pages/Starred'));
const Search = lazy(() => import('./pages/Search'));
const SharedWithMe = lazy(() => import('./pages/SharedWithMe'));
const PublicFile = lazy(() => import('./pages/PublicFile'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const PendingApproval = lazy(() => import('./pages/PendingApproval'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PageFallback() {
  return <div className="auth-loading" aria-label="Loading" />;
}

type SetupStatus = 'loading' | 'needed' | 'done';

function AppRouter() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('loading');

  useEffect(() => {
    client
      .get('/setup/status')
      .then((res) => {
        // The backend returns { setupRequired: boolean, configured: {...flags} }.
        // `configured` is an object (always truthy) — the source of truth is
        // the explicit setupRequired flag.
        setSetupStatus(res.data?.setupRequired ? 'needed' : 'done');
      })
      .catch(() => {
        // Status endpoint unreachable — assume setup is needed so the operator
        // reaches the wizard rather than a dead login page.
        setSetupStatus('needed');
      });
  }, []);

  if (setupStatus === 'loading') {
    return <div className="auth-loading" aria-label="Loading" />;
  }

  if (setupStatus === 'needed') {
    return (
      <Routes>
        <Route path="/setup" element={<Suspense fallback={<PageFallback />}><Setup /></Suspense>} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public-only: redirect authenticated users to drive */}
      <Route element={<PublicOnlyRoute />}>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageFallback />}>
              <Login />
            </Suspense>
          }
        />
      </Route>

      {/* Pending approval — accessible without full auth */}
      <Route
        path="/pending"
        element={
          <Suspense fallback={<PageFallback />}>
            <PendingApproval />
          </Suspense>
        }
      />

      {/* Public file access — no auth required */}
      <Route
        path="/p/:slug"
        element={
          <Suspense fallback={<PageFallback />}>
            <PublicFile />
          </Suspense>
        }
      />

      {/* Protected: redirect unauthenticated users to login */}
      <Route element={<ProtectedRoute />}>
        <Route
          path="/"
          element={
            <Suspense fallback={<PageFallback />}>
              <Drive />
            </Suspense>
          }
        />
        <Route
          path="/folder/:folderId"
          element={
            <Suspense fallback={<PageFallback />}>
              <Drive />
            </Suspense>
          }
        />
        <Route
          path="/trash"
          element={
            <Suspense fallback={<PageFallback />}>
              <Trash />
            </Suspense>
          }
        />
        <Route
          path="/starred"
          element={
            <Suspense fallback={<PageFallback />}>
              <Starred />
            </Suspense>
          }
        />
        <Route
          path="/search"
          element={
            <Suspense fallback={<PageFallback />}>
              <Search />
            </Suspense>
          }
        />
        <Route
          path="/shared"
          element={
            <Suspense fallback={<PageFallback />}>
              <SharedWithMe />
            </Suspense>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Suspense fallback={<PageFallback />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <Settings />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import client from '../api/client';

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: 'admin' | 'user';
  encryptionEnabled: boolean;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' };

interface AuthContextValue {
  state: AuthState;
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const fetchUser = useCallback(async () => {
    try {
      const { data } = await client.get<AuthUser>('/me');
      setState({ status: 'authenticated', user: data });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    await client.post('/auth/logout');
    setState({ status: 'unauthenticated' });
  }, []);

  const isLoading = state.status === 'loading';
  const isAuthenticated = state.status === 'authenticated';
  const user = state.status === 'authenticated' ? state.user : null;

  return (
    <AuthContext.Provider
      value={{ state, user, isLoading, isAuthenticated, logout, refresh: fetchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

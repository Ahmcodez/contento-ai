'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiRequest, setAccessToken } from '../api/client';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  useEffect(() => {
    let cancelled = false;

    // On first load there's no access token in memory (it's never
    // persisted to storage — only the httpOnly refresh cookie survives a
    // reload), so we attempt one silent refresh to restore the session.
    (async () => {
      try {
        const refreshed = await apiRequest('/api/v1/auth/refresh', { method: 'POST' });
        setAccessToken(refreshed.accessToken);
        const me = await authApi.fetchMe();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const loggedInUser = await authApi.login(credentials);
    setUser(loggedInUser);
    setStatus('authenticated');
    return loggedInUser;
  }, []);

  const register = useCallback(async (fields) => {
    const newUser = await authApi.register(fields);
    setUser(newUser);
    setStatus('authenticated');
    return newUser;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

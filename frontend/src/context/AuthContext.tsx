import { useState } from 'react';
import type { ReactNode } from 'react';
import { setToken, clearToken, isAuthenticated, getRole, api } from '../api';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [username, setUsername] = useState(localStorage.getItem('kap_user') || '');
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(() => getRole() === 'admin');

  const login = async (user: string, pass: string) => {
    setError('');
    try {
      const data = await api.login(user, pass);
      setToken(data.token);
      localStorage.setItem('kap_user', data.username);
      setUsername(data.username);
      setIsAdmin(getRole() === 'admin');
      setAuthenticated(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Giriş yapılamadı';
      setError(message);
      throw err;
    }
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem('kap_user');
    setAuthenticated(false);
    setUsername('');
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ authenticated, username, isAdmin, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

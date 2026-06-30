import { useState } from 'react';
import type { ReactNode } from 'react';
import { setToken, clearToken, isAuthenticated, api } from '../api';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [username, setUsername] = useState(localStorage.getItem('kap_user') || '');
  const [error, setError] = useState('');

  const login = async (user: string, pass: string) => {
    setError('');
    try {
      const data = await api.login(user, pass);
      setToken(data.token);
      localStorage.setItem('kap_user', data.username);
      setUsername(data.username);
      setAuthenticated(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Giris yapilamadi';
      setError(message);
      throw err;
    }
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem('kap_user');
    setAuthenticated(false);
    setUsername('');
  };

  return (
    <AuthContext.Provider value={{ authenticated, username, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

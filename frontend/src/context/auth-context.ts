import { createContext } from 'react';

export interface AuthState {
  authenticated: boolean;
  username: string;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  error: string;
}

export const AuthContext = createContext<AuthState>({
  authenticated: false,
  username: '',
  isAdmin: false,
  login: async () => undefined,
  logout: () => undefined,
  error: '',
});

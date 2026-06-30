import { createContext } from 'react';

export interface AuthState {
  authenticated: boolean;
  username: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  error: string;
}

export const AuthContext = createContext<AuthState>({
  authenticated: false,
  username: '',
  login: async () => undefined,
  logout: () => undefined,
  error: '',
});

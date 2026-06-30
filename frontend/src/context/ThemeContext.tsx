import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from './theme-context';

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('kap_theme', 'light');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'light', toggle: () => undefined }}>
      {children}
    </ThemeContext.Provider>
  );
}

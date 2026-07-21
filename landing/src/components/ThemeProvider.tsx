import { useLayoutEffect, useState } from 'react';
import { ThemeContext, type Theme } from './theme-context';

const STORAGE_KEY = 'theme';
const DEFAULT: Theme = 'dark';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored === 'dark' || stored === 'light' ? stored : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer reads localStorage during the render phase.
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  // useLayoutEffect runs synchronously after DOM mutations but before the
  // browser paints — no flash of wrong theme, no need for a "ready" gate.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage full or unavailable — theme still works for this session.
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeProvider;

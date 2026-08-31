import type { ResolvedTheme, ThemePreference } from './theme';
import { createContext, useContext } from 'react';

export interface ThemeContextValue {
    preference: ThemePreference;
    resolvedTheme: ResolvedTheme;
    setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme 必须在 ThemeProvider 内使用');
    return context;
}

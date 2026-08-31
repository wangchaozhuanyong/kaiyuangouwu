import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';

import {
    normalizeThemePreference,
    resolveTheme,
    THEME_STORAGE_KEY,
    type ResolvedTheme,
    type ThemePreference,
} from './theme';
import { ThemeContext } from './theme-context';

function readStoredPreference(): ThemePreference {
    try {
        return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return 'system';
    }
}

function readSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyResolvedTheme(theme: ResolvedTheme, preference: ThemePreference) {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = theme;

    document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#080d18' : '#f8fafc');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
    const [systemPrefersDark, setSystemPrefersDark] = useState(readSystemPreference);
    const resolvedTheme = resolveTheme(preference, systemPrefersDark);

    const setPreference = useCallback((nextPreference: ThemePreference) => {
        setPreferenceState(nextPreference);
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
        } catch {
            // 浏览器禁用本地存储时，当前会话内的主题切换仍然有效。
        }
    }, []);

    useLayoutEffect(() => {
        applyResolvedTheme(resolvedTheme, preference);
    }, [preference, resolvedTheme]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemThemeChange = (event: MediaQueryListEvent) => {
            setSystemPrefersDark(event.matches);
        };
        mediaQuery.addEventListener('change', handleSystemThemeChange);
        return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }, []);

    useEffect(() => {
        const handleStorageChange = (event: StorageEvent) => {
            if (event.key === THEME_STORAGE_KEY) {
                setPreferenceState(normalizeThemePreference(event.newValue));
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const value = useMemo(
        () => ({ preference, resolvedTheme, setPreference }),
        [preference, resolvedTheme, setPreference],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

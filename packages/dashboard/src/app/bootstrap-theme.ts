type ResolvedTheme = 'dark' | 'light';

export function resolveBootstrapTheme(
    serializedSettings: string | null,
    prefersDark: boolean,
): ResolvedTheme {
    try {
        const storedTheme = serializedSettings
            ? (JSON.parse(serializedSettings) as { theme?: unknown }).theme
            : undefined;
        if (storedTheme === 'dark' || storedTheme === 'light') {
            return storedTheme;
        }
    } catch {
        // Ignore corrupt local settings and follow the system theme instead.
    }
    return prefersDark ? 'dark' : 'light';
}

export function applyBootstrapTheme(storageKey: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    let serializedSettings: string | null = null;
    try {
        serializedSettings = window.localStorage.getItem(storageKey);
    } catch {
        // Storage may be unavailable in private or restricted browser contexts.
    }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const theme = resolveBootstrapTheme(serializedSettings, prefersDark);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
}

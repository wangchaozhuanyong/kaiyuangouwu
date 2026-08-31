export const THEME_STORAGE_KEY = 'vendure-admin-theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export function normalizeThemePreference(value: string | null): ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(
    preference: ThemePreference,
    systemPrefersDark: boolean,
): ResolvedTheme {
    if (preference !== 'system') return preference;
    return systemPrefersDark ? 'dark' : 'light';
}

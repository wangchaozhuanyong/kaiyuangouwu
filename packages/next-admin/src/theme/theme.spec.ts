import { describe, expect, it } from 'vitest';

import { normalizeThemePreference, resolveTheme } from './theme';

describe('theme preference', () => {
    it('accepts supported preferences and rejects stale values', () => {
        expect(normalizeThemePreference('light')).toBe('light');
        expect(normalizeThemePreference('dark')).toBe('dark');
        expect(normalizeThemePreference('system')).toBe('system');
        expect(normalizeThemePreference('legacy-dark-mode')).toBe('system');
        expect(normalizeThemePreference(null)).toBe('system');
    });

    it('resolves system preference without changing explicit choices', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });
});

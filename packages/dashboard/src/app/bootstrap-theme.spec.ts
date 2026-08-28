import { describe, expect, it } from 'vitest';

import { resolveBootstrapTheme } from './bootstrap-theme.js';

describe('resolveBootstrapTheme', () => {
    it('uses the saved dark theme during dashboard bootstrap', () => {
        expect(resolveBootstrapTheme(JSON.stringify({ theme: 'dark' }), false)).toBe('dark');
    });

    it('uses the saved light theme during dashboard bootstrap', () => {
        expect(resolveBootstrapTheme(JSON.stringify({ theme: 'light' }), true)).toBe('light');
    });

    it('uses the operating-system preference for the system theme', () => {
        expect(resolveBootstrapTheme(JSON.stringify({ theme: 'system' }), true)).toBe('dark');
        expect(resolveBootstrapTheme(JSON.stringify({ theme: 'system' }), false)).toBe('light');
    });

    it('falls back safely when saved settings are invalid', () => {
        expect(resolveBootstrapTheme('{invalid', true)).toBe('dark');
    });
});

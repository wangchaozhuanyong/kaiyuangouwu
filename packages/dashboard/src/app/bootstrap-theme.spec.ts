import { readFileSync } from 'node:fs';
import path from 'node:path';
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

describe('dashboard theme bootstrap asset', () => {
    it('loads the pre-paint theme bootstrap from a CSP-compatible external script', () => {
        const indexHtml = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

        expect(indexHtml).toContain('<script src="./bootstrap-theme.js"></script>');
        expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/u);
    });

    it('applies the saved theme before the dashboard bundle starts', () => {
        const script = readFileSync(path.resolve(process.cwd(), 'public/bootstrap-theme.js'), 'utf8');
        window.localStorage.setItem('vendure-user-settings', JSON.stringify({ theme: 'dark' }));
        document.documentElement.classList.remove('light', 'dark');

        window.eval(script);

        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
});

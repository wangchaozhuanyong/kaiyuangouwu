import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../public/storefront/restore-logo.js', import.meta.url), 'utf8');
describe('early logo restoration under production CSP', () => {
    it('keeps logo restoration in the app entry instead of a parser-blocking request', () => {
        const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
        const entry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
        expect(html).not.toContain('<script src="/storefront/restore-logo.js"></script>');
        expect(entry).toContain("sessionStorage.getItem('__storefront_logo_url__')");
        expect(html).not.toMatch(/<script>\s*\(function/);
    });
    it.each(['/assets/store-logo.png', null, 'javascript:alert(1)'])(
        'handles cached logo %s safely',
        cached => {
            const icon = { href: '/favicon.png' };
            runInNewContext(script, {
                URL,
                location: { origin: 'https://store.example' },
                sessionStorage: { getItem: () => cached },
                document: { querySelector: () => icon },
            });
            expect(icon.href).toBe(
                cached?.startsWith('/') ? 'https://store.example' + cached : '/favicon.png',
            );
        },
    );
});

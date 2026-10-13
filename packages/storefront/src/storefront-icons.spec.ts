// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { storefrontIcon } from '../../storefront-content-plugin/src/shared/storefront-icons';

import { applyStorefrontIcons, restoreStorefrontIcons } from './storefront-icons';

afterEach(() => {
    document.head.innerHTML = '';
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('storefront document icons', () => {
    it('uses bounded PNG variants and preserves existing URL parameters', () => {
        const source = 'https://shop.example/assets/preview/logo.webp?token=public&format=webp#logo';
        const icon = storefrontIcon(source, 'icon');
        const url = new URL(icon.href);
        expect(icon.type).toBe('image/png');
        expect(url.searchParams.get('preset')).toBe('storefront-icon-96');
        expect(url.searchParams.get('format')).toBe('png');
        expect(url.searchParams.get('token')).toBe('public');
        expect(url.searchParams.get('storefront-icon')).toBe('2');
        expect(url.hash).toBe('#logo');
        expect(storefrontIcon(source, 'apple-touch-icon').href).toContain(
            'preset=storefront-thumbnail-fit-320',
        );
    });
    it.each([null, '', 'javascript:alert(1)', 'data:text/html,<script>', '//other.example/logo.png'])(
        'uses neutral fallback for %s',
        source => {
            expect(storefrontIcon(source, 'icon')).toEqual({
                href: '/storefront/neutral-store.png?storefront-icon=2',
                type: 'image/png',
            });
        },
    );
    it('does not override fresh server icons with a previously cached logo', () => {
        document.head.innerHTML = [
            '<link rel="icon" href="/neutral.png">',
            '<link rel="icon" href="/fresh.png" data-storefront-icon="server">',
            '<link rel="apple-touch-icon" href="/fresh-touch.png" data-storefront-icon="server">',
        ].join('');
        sessionStorage.setItem('__storefront_logo_url__', '/old.webp');
        restoreStorefrontIcons();
        expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/fresh.png');
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
            '/fresh-touch.png',
        );
    });
    it('ignores an unscoped cached logo when the server fragment is unavailable', () => {
        document.head.innerHTML = '<link rel="icon" href="/previous-store.png">';
        sessionStorage.setItem(
            '__storefront_logo_url__',
            '/assets/preview/store.webp?preset=storefront-thumbnail-fit-160&format=webp',
        );
        restoreStorefrontIcons();
        for (const link of document.querySelectorAll('link')) {
            expect(link.getAttribute('href')).toBe('/storefront/neutral-store.png?storefront-icon=2');
        }
    });
    it('reuses an existing declaration and removes only redundant icons', () => {
        document.head.innerHTML = '<link rel="icon" href="/old.png"><link rel="icon" href="/older.png">';
        const inserted = [] as string[];
        const append = document.head.append.bind(document.head);
        vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
            for (const node of nodes) {
                if (node instanceof HTMLLinkElement) inserted.push(node.getAttribute('href') ?? '');
            }
            append(...nodes);
        });
        applyStorefrontIcons('/new.png');
        expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
        expect(inserted).toEqual(['/new.png?storefront-icon=2']);
        for (const link of document.querySelectorAll('link[rel="icon"]')) {
            expect(link.getAttribute('href')).toBe('/new.png?storefront-icon=2');
        }
        applyStorefrontIcons(null);
        for (const link of document.querySelectorAll('link')) {
            expect(link.getAttribute('href')).toBe('/storefront/neutral-store.png?storefront-icon=2');
        }
    });
    it('leaves matching server icons connected and untouched through repeated hydration', () => {
        const logo = 'https://shop.example/assets/preview/logo.webp';
        for (const rel of ['icon', 'apple-touch-icon'] as const) {
            const icon = storefrontIcon(logo, rel);
            const link = document.createElement('link');
            link.rel = rel;
            link.href = icon.href;
            link.type = icon.type;
            link.dataset.storefrontIcon = 'server';
            document.head.append(link);
        }
        const links = [...document.querySelectorAll('link')];
        const observer = new MutationObserver(() => undefined);
        observer.observe(document.head, { childList: true, subtree: true, attributes: true });
        try {
            applyStorefrontIcons(logo);
            applyStorefrontIcons(logo);
            expect([...document.querySelectorAll('link')]).toEqual(links);
            expect(observer.takeRecords()).toHaveLength(0);
        } finally {
            observer.disconnect();
        }
    });
    it('updates a changed brand in place without an empty-icon interval', () => {
        document.head.innerHTML = '<link rel="icon" href="/old.png" data-storefront-icon="server">';
        const original = document.querySelector('link');
        applyStorefrontIcons('/new.png');
        expect(document.querySelector('link[rel="icon"]')).toBe(original);
        expect(original?.getAttribute('href')).toBe('/new.png?storefront-icon=2');
        applyStorefrontIcons(null);
        expect(document.querySelector('link[rel="icon"]')).toBe(original);
        expect(original?.getAttribute('href')).toContain('/neutral-store.png');
    });
    it('treats an equivalent absolute browser URL as unchanged', () => {
        const href = new URL(storefrontIcon('/logo.png', 'icon').href, document.baseURI).href;
        document.head.innerHTML = `<link rel="icon" href="${href}" type="image/png">`;
        const original = document.querySelector('link');
        if (!original) throw new Error('Expected the initial icon');
        const setAttribute = vi.spyOn(original, 'setAttribute');
        applyStorefrontIcons('/logo.png');
        expect(document.querySelector('link[rel="icon"]')).toBe(original);
        expect(setAttribute).not.toHaveBeenCalled();
    });
    it('keeps the icon revision query before an existing URL fragment', () => {
        applyStorefrontIcons('/brand.png#symbol');
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
            '/brand.png?storefront-icon=2#symbol',
        );
    });
});

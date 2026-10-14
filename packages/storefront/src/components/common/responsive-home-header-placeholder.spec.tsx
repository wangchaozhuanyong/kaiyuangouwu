// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type StorefrontContentBlock } from '../../types';

import { ResponsiveHomeHeaderPlaceholder } from './responsive-home-header-placeholder';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const navigationBlock: StorefrontContentBlock = {
    id: 'navigation',
    code: 'navigation',
    type: 'NAVIGATION',
    enabled: true,
    title: '',
    subtitle: '',
    body: '',
    ctaLabel: '',
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    position: 0,
    settings: null,
    items: [
        ['home', '/', 'Home'],
        ['catalog', '/category', 'Catalog'],
        ['support', '/support', 'Support'],
        ['orders', '/orders', 'Orders'],
        ['favorites', '/favorites', 'Favorites'],
    ].map(([id, targetValue, label], position) => ({
        id,
        label,
        description: '',
        imageUrl: null,
        targetType: 'PAGE',
        targetValue,
        enabled: true,
        position,
        settings: null,
    })),
};

function header(language: 'zh' | 'en') {
    return (
        <ResponsiveHomeHeaderPlaceholder
            name="A storefront with a long merchant supplied name"
            logoUrl={null}
            language={language}
            currencyCode="MYR"
            routeName="category"
            navigationBlock={navigationBlock}
        />
    );
}

describe('public header before application startup', () => {
    let root: Root | undefined;
    let host: HTMLDivElement | undefined;

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
        host = undefined;
    });

    function serverHeader(language: 'zh' | 'en') {
        host = document.createElement('div');
        host.innerHTML = renderToString(header(language));
        document.body.append(host);
        return host;
    }

    it.each(['zh', 'en'] as const)(
        '%s exposes localized public destinations without JavaScript',
        language => {
            const element = serverHeader(language);
            const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>('a'));
            expect(anchors.map(anchor => anchor.getAttribute('href'))).toEqual([
                `/${language}/`,
                `/${language}/`,
                `/${language}/category`,
                `/${language}/support`,
            ]);
            for (const anchor of anchors) {
                expect(anchor.closest('[inert], [aria-hidden="true"]')).toBeNull();
            }
            expect(element.querySelector('[aria-current="page"]')?.textContent).toBe('Catalog');
            expect(element.querySelectorAll('.proto-nav-link')).toHaveLength(5);
            expect(element.querySelector('a[href*="orders"], a[href*="favorites"]')).toBeNull();
            expect(element.querySelector('.proto-header-right')?.hasAttribute('inert')).toBe(true);
            expect(element.querySelector('.desktop-search-anchor')?.hasAttribute('inert')).toBe(true);
        },
    );

    it('adopts the same public links and inactive controls without replacing the server markup', async () => {
        const element = serverHeader('zh');
        const initialHeader = element.querySelector('header');
        const initialLinks = Array.from(element.querySelectorAll('a'));
        const initialSearch = element.querySelector('.desktop-search-anchor');
        const recoverableError = vi.fn();

        await act(async () => {
            root = hydrateRoot(element, header('zh'), { onRecoverableError: recoverableError });
            await Promise.resolve();
        });

        expect(recoverableError).not.toHaveBeenCalled();
        expect(element.querySelector('header')).toBe(initialHeader);
        const adoptedLinks = Array.from(element.querySelectorAll('a'));
        expect(adoptedLinks).toHaveLength(initialLinks.length);
        adoptedLinks.forEach((link, index) => expect(link).toBe(initialLinks[index]));
        expect(element.querySelector('.desktop-search-anchor')).toBe(initialSearch);
        expect(initialSearch?.hasAttribute('inert')).toBe(true);
    });
});

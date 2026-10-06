// @vitest-environment jsdom
import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authOriginalImageUrl } from '../../storefront-content-plugin/src/shared/auth-visual';
import { heroImageForViewport } from '../../storefront-content-plugin/src/shared/hero-image';

import { preloadRouteMedia } from './route-media-preload';
import { SafeImage } from './safe-image';
import { StorefrontContentBlock } from './types';

vi.mock('react-dom', async importOriginal => ({
    ...(await importOriginal<typeof import('react-dom')>()),
    preload: vi.fn(),
}));

describe('navigation image hints', () => {
    beforeEach(() => vi.mocked(preload).mockClear());
    afterEach(() => vi.unstubAllGlobals());
    const block = (type: StorefrontContentBlock['type'], imageUrl: string) =>
        ({ id: type, type, enabled: true, imageUrl }) as StorefrontContentBlock;

    it('requests the exact candidate set and size that the auth image renders', () => {
        const content = block('AUTH_LOGIN', '/assets/preview/login.jpg?preset=storefront-hero-960');
        preloadRouteMedia({ name: 'login' }, [content], [], true);
        const [url, options] = vi.mocked(preload).mock.calls[0];
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <SafeImage
                src={authOriginalImageUrl(content.imageUrl ?? '')}
                alt=""
                imageKind="detail"
                sizes="(min-width: 1024px) 640px, 1px"
            />,
        );
        const image = host.querySelector('img');
        expect(image?.getAttribute('src')).toBe(url);
        expect(image?.getAttribute('srcset')).toBe(options?.imageSrcSet);
        expect(image?.getAttribute('sizes')).toBe(options?.imageSizes);
    });

    it('does not preload authentication artwork hidden by the mobile layout', () => {
        const content = block('AUTH_LOGIN', '/assets/preview/login.jpg');
        preloadRouteMedia({ name: 'login' }, [content], [], false);
        preloadRouteMedia({ name: 'register' }, [block('AUTH_REGISTER', content.imageUrl ?? '')], [], false);
        preloadRouteMedia({ name: 'forgot-password' }, [content], [], false);
        expect(preload).not.toHaveBeenCalled();
    });

    it.each([320, 390, 599, 600, 768, 1024])(
        'keeps the auth layout threshold independent of the home artwork threshold at %s px',
        width => {
            vi.stubGlobal('matchMedia', (query: string) => ({
                matches: width >= Number(query.match(/min-width:\s*(\d+)/)?.[1]),
            }));
            const content = block('AUTH_LOGIN', '/assets/preview/login.jpg');
            preloadRouteMedia({ name: 'login' }, [content], []);
            expect(preload).toHaveBeenCalledTimes(width >= 1024 ? 1 : 0);
        },
    );

    it('allows explicit home artwork viewport input without affecting authentication layout input', () => {
        const content: StorefrontContentBlock = {
            ...block('HERO', '/assets/preview/wide.jpg'),
            settings: { mobileImageUrl: '/assets/preview/phone.jpg' },
        };
        preloadRouteMedia({ name: 'home' }, [content], [], false, true);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('wide.jpg');
        vi.mocked(preload).mockClear();
        preloadRouteMedia({ name: 'home' }, [content], [], false, false);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('phone.jpg');
    });

    it('retains the explicit desktop fallback when no browser media query API is available', () => {
        vi.stubGlobal('matchMedia', undefined);
        const content: StorefrontContentBlock = {
            ...block('HERO', '/assets/preview/wide-fallback.jpg'),
            settings: { mobileImageUrl: '/assets/preview/phone-fallback.jpg' },
        };
        preloadRouteMedia({ name: 'home' }, [content], [], true);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('wide-fallback.jpg');
        vi.mocked(preload).mockClear();
        preloadRouteMedia({ name: 'home' }, [content], []);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('phone-fallback.jpg');
        vi.mocked(preload).mockClear();
        preloadRouteMedia({ name: 'login' }, [block('AUTH_LOGIN', '/login.jpg')], []);
        expect(preload).not.toHaveBeenCalled();
    });

    it('prepares only the first usable home slide, leaving later slides out of the route barrier', () => {
        preloadRouteMedia(
            { name: 'home' },
            [
                block('HERO', ''),
                block('HERO', '/assets/preview/first.jpg'),
                block('HERO', '/assets/preview/later.jpg'),
            ],
            [],
        );
        expect(preload).toHaveBeenCalledOnce();
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('first.jpg');
    });

    it.each([false, true])('preloads the same home artwork candidates that render, desktop=%s', desktop => {
        const content: StorefrontContentBlock = {
            ...block('HERO', '/assets/preview/desktop.jpg'),
            imageAsset: { width: 1600, height: 667 },
            settings: {
                mobileImageUrl: '/assets/preview/mobile.jpg',
                mobileImageWidth: 1200,
                mobileImageHeight: 910,
            },
        };
        preloadRouteMedia({ name: 'home' }, [content], [], desktop);
        const [url, options] = vi.mocked(preload).mock.calls[0];
        const media = heroImageForViewport(content, desktop);
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <SafeImage src={media.imageUrl} alt="" imageKind="hero" {...media.imageAsset} />,
        );
        const image = host.querySelector('img');
        expect(url).toContain(desktop ? 'desktop.jpg' : 'mobile.jpg');
        expect(image?.getAttribute('src')).toBe(url);
        expect(image?.getAttribute('srcset')).toBe(options?.imageSrcSet);
        expect(image?.getAttribute('sizes')).toBe(options?.imageSizes);
    });

    it('uses the first mobile-capable slide and retains desktop fallback for unconfigured stores', () => {
        const mobileOnly = {
            ...block('HERO', ''),
            settings: { mobileImageUrl: '/assets/preview/mobile-only.jpg' },
        };
        const desktopFallback = block('HERO', '/assets/preview/shared.jpg');
        preloadRouteMedia({ name: 'home' }, [mobileOnly, desktopFallback], [], false);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('mobile-only.jpg');
        vi.mocked(preload).mockClear();
        preloadRouteMedia({ name: 'home' }, [mobileOnly, desktopFallback], [], true);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('shared.jpg');
        vi.mocked(preload).mockClear();
        preloadRouteMedia({ name: 'home' }, [desktopFallback], [], false);
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('shared.jpg');
    });

    it('does not preload an arbitrary catalog product when no home hero is configured', () => {
        preloadRouteMedia(
            { name: 'home' },
            [],
            [
                {
                    id: 'product-1',
                    name: 'First product',
                    slug: 'first-product',
                    featuredAsset: { id: 'asset-1', preview: '/assets/preview/first-product.jpg' },
                    assets: [],
                    variants: [],
                    collections: [],
                    description: '',
                    createdAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        );

        expect(preload).not.toHaveBeenCalled();
    });

    it('does not speculate about missing products or unrelated route media', () => {
        preloadRouteMedia({ name: 'product', id: 'unknown' }, [], []);
        preloadRouteMedia({ name: 'search' }, [block('HERO', '/assets/preview/first.jpg')], []);
        expect(preload).not.toHaveBeenCalled();
    });
});

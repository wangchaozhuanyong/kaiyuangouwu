// @vitest-environment jsdom
import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authOriginalImageUrl } from '../../storefront-content-plugin/src/shared/auth-visual';

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

    it.each([767, 768, 1024])(
        'leaves responsive home artwork priority to the rendered image at %s px',
        width => {
            vi.stubGlobal(
                'matchMedia',
                vi.fn((query: string) => ({
                    matches: query === '(max-width: 767px)' ? width <= 767 : width >= 1024,
                })),
            );
            preloadRouteMedia(
                { name: 'home' },
                [
                    {
                        ...block('HERO', '/assets/preview/desktop.jpg'),
                        settings: { mobileImageUrl: '/assets/preview/phone.jpg' },
                    },
                ],
                [],
                width >= 1024,
            );
            expect(preload).not.toHaveBeenCalled();
        },
    );

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

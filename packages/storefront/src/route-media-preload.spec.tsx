// @vitest-environment jsdom
import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const block = (type: StorefrontContentBlock['type'], imageUrl: string) =>
        ({ id: type, type, enabled: true, imageUrl }) as StorefrontContentBlock;

    it('requests the exact candidate set and size that the auth image renders', () => {
        const content = block('AUTH_LOGIN', '/assets/preview/login.jpg?preset=storefront-hero-960');
        preloadRouteMedia({ name: 'login' }, [content], []);
        const [url, options] = vi.mocked(preload).mock.calls[0];
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <SafeImage
                src={authOriginalImageUrl(content.imageUrl ?? '')}
                alt=""
                imageKind="detail"
                sizes="(min-width: 1024px) 640px, 100vw"
            />,
        );
        const image = host.querySelector('img');
        expect(image?.getAttribute('src')).toBe(url);
        expect(image?.getAttribute('srcset')).toBe(options?.imageSrcSet);
        expect(image?.getAttribute('sizes')).toBe(options?.imageSizes);
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

    it('prepares the first product when a home page has no managed hero', () => {
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

        expect(preload).toHaveBeenCalledOnce();
        expect(vi.mocked(preload).mock.calls[0][0]).toContain('first-product.jpg');
        expect(vi.mocked(preload).mock.calls[0][1]).toMatchObject({
            fetchPriority: 'high',
            imageSizes: '(min-width: 1280px) 202px, (min-width: 1024px) 18vw, calc(50vw - 24px)',
        });
    });

    it('does not speculate about missing products or unrelated route media', () => {
        preloadRouteMedia({ name: 'product', id: 'unknown' }, [], []);
        preloadRouteMedia({ name: 'search' }, [block('HERO', '/assets/preview/first.jpg')], []);
        expect(preload).not.toHaveBeenCalled();
    });
});

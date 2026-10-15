import { describe, expect, it } from 'vitest';

import { authOriginalImageUrl } from './auth-visual-utils';
import { primaryStorefrontMedia } from './primary-media';

const desktop = '/assets/preview/desktop.webp?v=2';
const phone = '/assets/preview/phone.webp?v=3';
describe('shared primary storefront media', () => {
    it('matches home and services art direction at their actual breakpoints', () => {
        const settings = { mobileImageUrl: phone };
        expect(
            primaryStorefrontMedia({
                route: 'home',
                blocks: [{ type: 'HERO', imageUrl: desktop, settings }],
            }),
        ).toEqual([
            { source: phone, kind: 'hero', media: '(max-width: 767px)' },
            { source: desktop, kind: 'hero', media: '(min-width: 768px)' },
        ]);
        expect(
            primaryStorefrontMedia({
                route: 'services',
                blocks: [
                    {
                        type: 'CLIENT_PLUGINS',
                        code: 'storefront-client-plugins',
                        imageUrl: desktop,
                        settings,
                    },
                ],
            }),
        ).toEqual([
            { source: phone, kind: 'hero', media: '(max-width: 1023px)' },
            { source: desktop, kind: 'hero', media: '(min-width: 1024px)' },
        ]);
    });
    it('ignores phone artwork in the shared services banner and hidden/foreign blocks', () => {
        expect(
            primaryStorefrontMedia({
                route: 'services',
                blocks: [
                    { type: 'CLIENT_PLUGINS', code: 'other', imageUrl: '/wrong.webp' },
                    {
                        type: 'CLIENT_PLUGINS',
                        code: 'storefront-client-plugins',
                        imageUrl: desktop,
                        settings: { mobileImageUrl: phone, businessServicesHeroLayout: 'shared-banner' },
                    },
                ],
            }),
        ).toEqual([{ source: desktop, kind: 'hero' }]);
        expect(
            primaryStorefrontMedia({
                route: 'home',
                blocks: [{ type: 'HERO', enabled: false, imageUrl: desktop }],
            }),
        ).toEqual([]);
        expect(
            primaryStorefrontMedia({
                route: 'services',
                blocks: [
                    {
                        type: 'CLIENT_PLUGINS',
                        code: 'storefront-client-plugins',
                        settings: { mobileImageUrl: phone },
                    },
                ],
            }),
        ).toEqual([{ source: phone, kind: 'hero', media: '(max-width: 1023px)' }]);
    });
    it('uses only actual support artwork and desktop auth original candidate', () => {
        const blocks = [
            { type: 'SUPPORT', imageUrl: desktop },
            { type: 'AUTH_LOGIN', imageUrl: phone },
        ];
        expect(primaryStorefrontMedia({ route: 'support', blocks })).toEqual([
            { source: desktop, kind: 'hero', media: '(min-width: 1024px)' },
        ]);
        expect(primaryStorefrontMedia({ route: 'forgot-password', blocks })).toEqual([
            {
                source: authOriginalImageUrl(phone),
                kind: 'detail',
                sizes: '(min-width: 1024px) 640px, 1px',
                media: '(min-width: 1024px)',
            },
        ]);
        expect(primaryStorefrontMedia({ route: 'register', blocks })).toEqual([]);
    });
    it('does not borrow unrelated product data and preserves route-specific detail/card geometry', () => {
        const item = { featuredAsset: { preview: desktop } };
        expect(primaryStorefrontMedia({ route: 'product', catalogItems: [item] })).toEqual([]);
        expect(primaryStorefrontMedia({ route: 'product', product: item })).toEqual([
            { source: desktop, kind: 'detail' },
        ]);
        expect(
            primaryStorefrontMedia({ route: 'catalog', catalogItems: [item], catalogPath: '/search' }),
        ).toHaveLength(2);
        expect(primaryStorefrontMedia({ route: 'home', catalogItems: [item] })).toEqual([]);
    });
});

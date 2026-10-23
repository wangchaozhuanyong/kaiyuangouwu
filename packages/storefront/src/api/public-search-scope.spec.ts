// organize-imports-ignore -- Keep the project ESLint import groups.
// @vitest-environment jsdom
import type { MarketConfig } from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    effectivePublicCatalogInput,
    type PublicPageRequest,
} from '../../../storefront-content-plugin/src/shared/public-page-data';
import { ShopApi } from '../api';

const mocks = vi.hoisted(() => ({ fetchPublicPage: vi.fn(), seedPublicPage: vi.fn() }));
vi.mock('../storefront-page-data', () => mocks);

const market: MarketConfig = {
    code: 'my-main',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
});

describe('global search public request scope', () => {
    it.each(['Gemini', '梳妆台', '331', '坦克', '马来西亚办理第二家园'])(
        'searches all visible collections for %s even when launched from home',
        async term => {
            window.history.replaceState({}, '', '/en/home');
            mocks.fetchPublicPage.mockResolvedValue({ catalog: { items: [], totalItems: 0 } });
            await new ShopApi(market).searchProducts(term);
            const request = mocks.fetchPublicPage.mock.calls[0][3] as Extract<
                PublicPageRequest,
                { kind: 'catalog' }
            >;
            expect(request.path).toBe('/search');
            const input = effectivePublicCatalogInput(request, [
                { id: 'unrelated-first', productVariantCount: 2 },
            ]);
            expect(input.term).toBe(term);
            expect(input.collectionId).toBeUndefined();
            expect(mocks.fetchPublicPage.mock.calls[0][4]).toBe(market.code);
        },
    );

    it('preserves an explicitly selected collection instead of broadening visibility', async () => {
        mocks.fetchPublicPage.mockResolvedValue({ catalog: { items: [], totalItems: 0 } });
        await new ShopApi(market).searchProducts('331', 'recommended', 0, 20, 'selected');
        const request = mocks.fetchPublicPage.mock.calls[0][3] as Extract<
            PublicPageRequest,
            { kind: 'catalog' }
        >;
        expect(
            effectivePublicCatalogInput(request, [{ id: 'unrelated-first', productVariantCount: 2 }])
                .collectionId,
        ).toBe('selected');
    });
});

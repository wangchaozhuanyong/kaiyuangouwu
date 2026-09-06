import { describe, expect, it } from 'vitest';

import { isSupportedContentSchemaFallback } from './content-compatibility';
import { ShopApiGraphQlError } from './helpers';

describe('content schema compatibility boundary', () => {
    const missing = 'Cannot query field "activeStorefrontFlashSales" on type "Query".';

    it('recognizes the optional fields removed by the legacy query', () => {
        expect(isSupportedContentSchemaFallback(new ShopApiGraphQlError([missing], 200), 'content')).toBe(
            true,
        );
        expect(
            isSupportedContentSchemaFallback(
                new ShopApiGraphQlError(
                    [missing, 'Cannot query field "settings" on type "StorefrontContentItem".'],
                    400,
                ),
                'content',
            ),
        ).toBe(true);
    });

    it('preserves required schema errors and mixed permission failures', () => {
        for (const messages of [
            ['Cannot query field "storefrontContent" on type "Query".'],
            ['Cannot query field "title" on type "StorefrontContentBlock".'],
            [missing, 'You are not currently authorized to perform this action'],
        ]) {
            expect(isSupportedContentSchemaFallback(new ShopApiGraphQlError(messages, 200), 'content')).toBe(
                false,
            );
        }
    });

    it('does not downgrade network errors or non-validation HTTP failures', () => {
        expect(isSupportedContentSchemaFallback(new Error(missing), 'content')).toBe(false);
        for (const status of [401, 403, 429, 500]) {
            expect(
                isSupportedContentSchemaFallback(new ShopApiGraphQlError([missing], status), 'content'),
            ).toBe(false);
        }
    });

    it('keeps coupon fallback limited to the absent root field', () => {
        expect(
            isSupportedContentSchemaFallback(
                new ShopApiGraphQlError(
                    ['Cannot query field "activeStorefrontCoupons" on type "Query".'],
                    200,
                ),
                'coupons',
            ),
        ).toBe(true);
        expect(isSupportedContentSchemaFallback(new ShopApiGraphQlError([missing], 200), 'coupons')).toBe(
            false,
        );
    });
});

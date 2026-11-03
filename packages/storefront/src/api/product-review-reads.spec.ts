// organize-imports-ignore -- Preserve ESLint type groups.
import type { ShopApiContext } from './client-context';
import { describe, expect, it, vi } from 'vitest';

import { ContentReviewsApi } from './content-reviews';

describe('lazy review reads', () => {
    it('preserves the caller pagination, cancellation, and successful empty results', async () => {
        const reviews = { totalItems: 0, averageRating: 0, items: [] };
        const request = vi
            .fn()
            .mockResolvedValueOnce({ storefrontProductReviews: reviews })
            .mockResolvedValueOnce({ myStorefrontReviewCandidates: [] })
            .mockResolvedValueOnce({ myStorefrontReviews: [] })
            .mockResolvedValueOnce({ storefrontReviewSettings: { enabled: false } });
        const api = new ContentReviewsApi({ request } as unknown as ShopApiContext);
        const controller = new AbortController();
        await expect(api.productReviews('p1', { skip: 20, take: 10 }, controller.signal)).resolves.toEqual(
            reviews,
        );
        await expect(api.reviewCandidates({ skip: 10, take: 10 }, controller.signal)).resolves.toEqual([]);
        await expect(api.myReviews(controller.signal)).resolves.toEqual([]);
        await expect(api.reviewSettings(controller.signal)).resolves.toEqual({ enabled: false });
        expect(request.mock.calls[0][1]).toEqual({ productId: 'p1', options: { skip: 20, take: 10 } });
        expect(request.mock.calls[1][1]).toEqual({ options: { skip: 10, take: 10 } });
        expect(request.mock.calls.every(call => call[2] === controller.signal)).toBe(true);
    });

    it('keeps query errors available to the existing retry UI without returning empty success', async () => {
        const error = new DOMException('Cancelled', 'AbortError');
        const request = vi.fn().mockRejectedValue(error);
        const api = new ContentReviewsApi({ request } as unknown as ShopApiContext);
        await expect(api.productReviews('p1')).rejects.toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
    });
});

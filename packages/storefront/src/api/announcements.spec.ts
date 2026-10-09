// organize-imports-ignore -- Preserve ESLint type groups.
import type { ShopApiContext } from './client-context';
import { describe, expect, it, vi } from 'vitest';

import { AnnouncementsApi } from './announcements';
import { ContentReviewsApi } from './content-reviews';

describe('storefront announcement API', () => {
    it('passes real pagination and cancellation to the paginated query, without using the capped home feed', async () => {
        const result = { items: [{ id: '25', title: 'Older announcement' }], totalItems: 25 };
        const request = vi.fn().mockResolvedValue({ storefrontAnnouncements: result });
        const api = new AnnouncementsApi({ request } as unknown as ShopApiContext);
        const controller = new AbortController();
        await expect(api.list({ skip: 24, take: 12 }, controller.signal)).resolves.toEqual(result);
        expect(request).toHaveBeenCalledWith(
            expect.stringContaining('$options: StorefrontAnnouncementPageOptions'),
            { options: { skip: 24, take: 12 } },
            controller.signal,
            undefined,
            undefined,
            undefined,
        );
        expect(request.mock.calls[0][0]).not.toContain('activeSystemAnnouncements');
    });

    it('returns a missing direct detail as null and passes the requested id and abort signal', async () => {
        const request = vi.fn().mockResolvedValue({ storefrontAnnouncement: null });
        const api = new AnnouncementsApi({ request } as unknown as ShopApiContext);
        const controller = new AbortController();
        await expect(api.detail('expired-25', controller.signal)).resolves.toBeNull();
        expect(request).toHaveBeenCalledWith(
            expect.stringContaining('storefrontAnnouncement(id: $id)'),
            { id: 'expired-25' },
            controller.signal,
            undefined,
            undefined,
            undefined,
        );
    });

    it.each(['list', 'detail'] as const)(
        'preserves %s errors for shared retry presentation instead of returning an empty success',
        async method => {
            const error = new Error('Fixture network unavailable');
            const request = vi.fn().mockRejectedValue(error);
            const api = new AnnouncementsApi({ request } as unknown as ShopApiContext);
            await expect(
                method === 'list' ? api.list({ skip: 0, take: 12 }) : api.detail('one'),
            ).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(1);
        },
    );

    it('makes list and detail available through the shared content API lazy boundary', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ storefrontAnnouncements: { totalItems: 0, items: [] } })
            .mockResolvedValueOnce({ storefrontAnnouncement: null });
        const api = new ContentReviewsApi({ request } as unknown as ShopApiContext);
        const controller = new AbortController();
        await expect(api.announcements({ skip: 12, take: 12 }, controller.signal)).resolves.toEqual({
            totalItems: 0,
            items: [],
        });
        await expect(api.announcement('one', controller.signal)).resolves.toBeNull();
        expect(request.mock.calls.every(call => call[2] === controller.signal)).toBe(true);
    });
});

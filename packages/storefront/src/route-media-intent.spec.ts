import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareRouteMedia } from './route-media-intent';
import { preloadRouteMedia } from './route-media-preload';

vi.mock('./route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));

describe('optional navigation media preparation', () => {
    beforeEach(() => vi.mocked(preloadRouteMedia).mockReset());

    it('returns immediately while the deferred selector prepares the exact destination', async () => {
        const route = { name: 'services' } as const;
        expect(prepareRouteMedia(route, [], [])).toBeUndefined();
        await vi.dynamicImportSettled();
        expect(preloadRouteMedia).toHaveBeenCalledExactlyOnceWith(route, [], []);
    });

    it('absorbs optional hint failures so navigation remains independent', async () => {
        vi.mocked(preloadRouteMedia).mockImplementationOnce(() => {
            throw new Error('Optional hint unavailable');
        });
        expect(prepareRouteMedia({ name: 'home' }, [], [])).toBeUndefined();
        await vi.dynamicImportSettled();
        expect(preloadRouteMedia).toHaveBeenCalledOnce();
    });
});

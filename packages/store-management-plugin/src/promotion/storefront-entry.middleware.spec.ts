import { describe, expect, it, vi } from 'vitest';

import { StorefrontEntryMiddleware } from './storefront-entry.middleware';

describe('direct public storefront entry', () => {
    it('allows a recognized store without an entry ticket or login', async () => {
        const access = { enabled: true, resolveRequest: vi.fn().mockResolvedValue({ ctx: {} }) };
        const next = vi.fn();
        const res = { setHeader: vi.fn(), status: vi.fn() };
        await new StorefrontEntryMiddleware(access as never).use(
            { method: 'POST', headers: {} } as never,
            res as never,
            next,
        );
        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('keeps unrecognized hosts out of the shop API', async () => {
        const access = { enabled: true, resolveRequest: vi.fn().mockResolvedValue(null) };
        const next = vi.fn();
        const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
        await new StorefrontEntryMiddleware(access as never).use(
            { method: 'POST', headers: {} } as never,
            res as never,
            next,
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

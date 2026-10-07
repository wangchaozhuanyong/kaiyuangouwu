import { describe, expect, it, vi } from 'vitest';

import { StorefrontClosedError } from '../storefront-activation.service';

import { StorefrontEntryMiddleware } from './storefront-entry.middleware';

describe('direct public storefront entry', () => {
    it('returns the dedicated GraphQL closure signal before passing the request to any resolver', async () => {
        const access = {
            enabled: true,
            resolveRequest: vi.fn().mockRejectedValue(new StorefrontClosedError()),
        };
        const next = vi.fn();
        const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
        await new StorefrontEntryMiddleware(access as never).use(
            { method: 'POST', headers: {} } as never,
            res as never,
            next,
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.json).toHaveBeenCalledWith({
            errorCode: 'STOREFRONT_CLOSED',
            message: 'Store not open yet',
            errors: [{ message: 'Store not open yet', extensions: { code: 'STOREFRONT_CLOSED' } }],
        });
    });

    it('keeps ordinary access failures distinct from explicit closure', async () => {
        const failure = new Error('temporary routing failure');
        const access = { enabled: true, resolveRequest: vi.fn().mockRejectedValue(failure) };
        const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
        await expect(
            new StorefrontEntryMiddleware(access as never).use(
                { method: 'POST' } as never,
                res as never,
                vi.fn(),
            ),
        ).rejects.toBe(failure);
        expect(res.status).not.toHaveBeenCalled();
    });

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

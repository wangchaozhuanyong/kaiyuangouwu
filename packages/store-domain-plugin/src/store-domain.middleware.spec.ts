import { describe, expect, it, vi } from 'vitest';

import { StoreDomainMiddleware } from './store-domain.middleware';

function createMiddleware(
    route: { status: 'PENDING' | 'ACTIVE'; channelToken: string } | null,
    options: { routingMode?: 'prefer-domain' | 'require-domain'; trustProxyHeaders?: boolean } = {},
) {
    const resolveRoute = vi.fn().mockResolvedValue(route);
    const middleware = new StoreDomainMiddleware(
        { apiOptions: { channelTokenKey: 'vendure-token' } } as any,
        { resolveRoute } as any,
        {
            cnameTarget: 'shops.example.com',
            routingMode: options.routingMode ?? 'prefer-domain',
            trustProxyHeaders: options.trustProxyHeaders ?? false,
            bypassHosts: ['localhost', '127.0.0.1'],
            resolveTxt: vi.fn(),
        },
    );
    return { middleware, resolveRoute };
}

function createResponse() {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { response: { status } as any, status, json };
}

describe('StoreDomainMiddleware', () => {
    it('forces both header and query channel tokens to the verified domain channel', async () => {
        const { middleware } = createMiddleware({ status: 'ACTIVE', channelToken: 'trusted-shop' });
        const request = {
            headers: { host: 'Shop.Example.com:443', 'vendure-token': 'attacker-shop' },
            query: { 'vendure-token': 'attacker-shop', languageCode: 'zh_Hans' },
        } as any;
        const { response, status } = createResponse();
        const next = vi.fn();

        await middleware.use(request, response, next);

        expect(request.headers['vendure-token']).toBe('trusted-shop');
        expect(request.query).toEqual({
            'vendure-token': 'trusted-shop',
            languageCode: 'zh_Hans',
        });
        expect(next).toHaveBeenCalledOnce();
        expect(status).not.toHaveBeenCalled();
    });

    it('rejects a pending domain', async () => {
        const { middleware } = createMiddleware({ status: 'PENDING', channelToken: 'shop' });
        const { response, status, json } = createResponse();

        await middleware.use(
            { headers: { host: 'pending.example.com' }, query: {} } as any,
            response,
            vi.fn(),
        );

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({
                errors: [
                    expect.objectContaining({
                        extensions: { code: 'STORE_DOMAIN_NOT_ACTIVE' },
                    }),
                ],
            }),
        );
    });

    it('rejects an unknown host in require-domain mode', async () => {
        const { middleware } = createMiddleware(null, { routingMode: 'require-domain' });
        const { response, status } = createResponse();

        await middleware.use(
            { headers: { host: 'unknown.example.com' }, query: {} } as any,
            response,
            vi.fn(),
        );

        expect(status).toHaveBeenCalledWith(404);
    });

    it('uses x-forwarded-host only when proxy headers are trusted', async () => {
        const { middleware, resolveRoute } = createMiddleware(null, { trustProxyHeaders: true });
        const { response } = createResponse();

        await middleware.use(
            {
                headers: {
                    host: 'internal.example.net',
                    'x-forwarded-host': 'merchant.example.com, edge.internal',
                },
                query: {},
            } as any,
            response,
            vi.fn(),
        );

        expect(resolveRoute).toHaveBeenCalledWith('merchant.example.com');
    });

    it('preserves normal token routing for bypass hosts', async () => {
        const { middleware, resolveRoute } = createMiddleware(null, { routingMode: 'require-domain' });
        const request = {
            headers: { host: 'localhost:3000', 'vendure-token': 'local-shop' },
            query: {},
        } as any;
        const { response, status } = createResponse();
        const next = vi.fn();

        await middleware.use(request, response, next);

        expect(resolveRoute).not.toHaveBeenCalled();
        expect(request.headers['vendure-token']).toBe('local-shop');
        expect(next).toHaveBeenCalledOnce();
        expect(status).not.toHaveBeenCalled();
    });
});

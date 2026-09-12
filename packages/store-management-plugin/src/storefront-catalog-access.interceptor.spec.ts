import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

const parsed = vi.hoisted(() => ({
    isGraphQL: true,
    req: { headers: {} },
    res: { setHeader: vi.fn() },
    info: { parentType: { name: 'Query' }, fieldName: 'products' },
}));
const ctx = vi.hoisted(() => ({ apiType: 'shop', activeUserId: undefined as string | undefined }));
vi.mock('@vendure/core', () => ({
    parseContext: () => parsed,
    internal_getRequestContext: () => ctx,
    ForbiddenError: class ForbiddenError extends Error {},
}));

import { StorefrontCatalogAccessInterceptor } from './storefront-catalog-access.interceptor';

function invoke(field: string, parent = 'Query', userId?: string, apiType = 'shop') {
    parsed.info = { parentType: { name: parent }, fieldName: field };
    parsed.req.headers = { cookie: 'storefront-entry=valid-looking-ticket' };
    ctx.activeUserId = userId;
    ctx.apiType = apiType;
    const next = { handle: vi.fn(() => of('resolver-data')) };
    const run = () => new StorefrontCatalogAccessInterceptor().intercept({} as never, next);
    return { run, next };
}

describe('private storefront catalog', () => {
    it.each([
        'products',
        'product',
        'search',
        'collections',
        'collection',
        'storefrontCatalog',
        'storefrontProductSales',
        'activeStorefrontFlashSales',
        'activeStorefrontCoupons',
        'activeSystemAnnouncements',
        'storefrontContentSettings',
        'futureCatalogExport',
    ])('rejects anonymous %s, including requests with an entry cookie', field => {
        const { run, next } = invoke(field);
        expect(run).toThrow();
        expect(next.handle).not.toHaveBeenCalled();
    });
    it('does not treat a mutation name used as a query alias as account access', () => {
        const { run } = invoke('products');
        Object.assign(parsed.info, { path: { key: 'login' }, operation: { name: { value: 'Login' } } });
        expect(run).toThrow();
        expect(invoke('login', 'Query').run).toThrow();
    });
    it.each(['activeCustomer', 'storefrontBranding', 'storefrontContent', 'activeChannel'])(
        'preserves public account bootstrap: %s',
        field => expect(invoke(field).run).not.toThrow(),
    );
    it.each(['login', 'registerCustomerAccount', 'requestPasswordReset', 'resetPassword'])(
        'preserves account mutation: %s',
        field => expect(invoke(field, 'Mutation').run).not.toThrow(),
    );
    it('accepts authenticated catalog reads and leaves Admin authorization unchanged', () => {
        expect(invoke('products', 'Query', 'customer-user').run).not.toThrow();
        expect(invoke('products', 'Query', undefined, 'admin').run).not.toThrow();
    });
    it('prevents authenticated catalog responses from entering a shared cache', () => {
        invoke('products', 'Query', 'customer-user').run();
        expect(parsed.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(parsed.res.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow, noarchive');
    });
});

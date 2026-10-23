import { readFileSync } from 'node:fs';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parsed = vi.hoisted(() => ({
    isGraphQL: true,
    req: { headers: {} },
    res: { setHeader: vi.fn() },
    info: { parentType: { name: 'Query' }, fieldName: 'products' },
}));
const ctx = vi.hoisted(() => ({
    apiType: 'shop',
    channelId: 'store-one',
    activeUserId: undefined as string | undefined,
    setReplicationMode: vi.fn(),
}));
const readAuthSettings = vi.hoisted(() => vi.fn());
vi.mock('@vendure/core', () => ({
    parseContext: () => parsed,
    internal_getRequestContext: () => ctx,
    ForbiddenError: class ForbiddenError extends Error {},
    SettingsStoreService: class SettingsStoreService {},
}));
vi.mock('@vendure/storefront-content-plugin', () => ({
    readStorefrontAuthSettings: readAuthSettings,
}));

import { StorefrontCatalogAccessInterceptor } from './storefront-catalog-access.interceptor';

function invoke(field: string, parent = 'Query', userId?: string, apiType = 'shop') {
    parsed.info = { parentType: { name: parent }, fieldName: field };
    parsed.req.headers = { cookie: 'storefront-entry=valid-looking-ticket' };
    ctx.activeUserId = userId;
    ctx.apiType = apiType;
    const next = { handle: vi.fn(() => of('resolver-data')) };
    const run = () => new StorefrontCatalogAccessInterceptor({} as never).intercept({} as never, next);
    return { run, next };
}

beforeEach(() => {
    vi.clearAllMocks();
    readAuthSettings.mockResolvedValue({ emailPasswordEnabled: true });
});

describe('public storefront browsing boundary', () => {
    it('keeps the catalog resolvers public browsing contract aligned with the anonymous gate', () => {
        const source = readFileSync(
            new URL('../../storefront-catalog-plugin/src/storefront-catalog.resolver.ts', import.meta.url),
            'utf8',
        );
        const queries = [...source.matchAll(/@Query\(\)\s+@Allow\(Permission\.Public\)\s+(\w+)\(/gu)].map(
            match => match[1],
        );
        expect(queries).toContain('storefrontDailyRecommendations');
        for (const query of queries) {
            expect(invoke(query).run, query).not.toThrow();
            expect(invoke(query, 'Mutation').run, query).toThrow();
        }
    });
    it('admits only the declared anonymous recharge operations before their service checks', () => {
        for (const field of ['gptRechargeConfig', 'gptRechargeTask']) {
            const { run, next } = invoke(field);
            expect(run).not.toThrow();
            expect(next.handle).toHaveBeenCalledTimes(1);
            expect(invoke(field, 'Mutation').run).toThrow();
        }
        for (const field of [
            'verifyGptRechargeCode',
            'queryGptRechargeCode',
            'submitGptRecharge',
            'createShopAbuseChallenge',
        ]) {
            const { run, next } = invoke(field, 'Mutation');
            expect(run).not.toThrow();
            expect(next.handle).toHaveBeenCalledTimes(1);
            expect(invoke(field).run).toThrow();
        }
        expect(invoke('gptRechargeAdminConfig').run).toThrow();
        expect(invoke('updateGptRechargeConfig', 'Mutation').run).toThrow();
        expect(invoke('futureRechargeExport').run).toThrow();
    });
    it.each([
        'products',
        'product',
        'search',
        'collections',
        'collection',
        'storefrontCatalog',
        'storefrontDailyRecommendations',
        'storefrontProductSales',
        'activeStorefrontFlashSales',
        'activeStorefrontCoupons',
        'activeSystemAnnouncements',
        'storefrontAnnouncements',
        'storefrontAnnouncement',
        'storefrontContentSettings',
        'storefrontProductReviews',
        'storefrontReviewSettings',
        'activeStoreCommerceMode',
        'icloudQueryMails',
        'storefrontOrderByConfirmationToken',
        'myDigitalDeliveryContents',
        'orderAdditionalPaymentQuote',
    ])('allows anonymous public browsing: %s', field => {
        const { run, next } = invoke(field);
        expect(run).not.toThrow();
        expect(next.handle).toHaveBeenCalled();
    });
    it.each([
        'futureCatalogExport',
        'order',
        'myStorefrontReviews',
        'myAfterSalesRequests',
        'myAvailableCoupons',
        'imageStudioWallet',
        'myImageGenerationJobs',
        'previewImageGenerationPrompt',
        'icloudPrimaryAccounts',
        'icloudReceivedMails',
        'myDeliveryEmails',
    ])('keeps private and unreviewed queries protected: %s', field => expect(invoke(field).run).toThrow());
    it.each([
        'storefrontDailyRecommendations',
        'setCustomerAvatar',
        'createAfterSalesRequest',
        'createImageGeneration',
        'resetIcloudMasterCode',
        'storefrontAnnouncements',
        'storefrontAnnouncement',
        'createIcloudPrimaryAccount',
        'icloudQueryMails',
        'saveMyDeliveryEmail',
        'setMyDefaultDeliveryEmail',
        'deleteMyDeliveryEmail',
    ])('does not make customer mutations public: %s', field =>
        expect(invoke(field, 'Mutation').run).toThrow(),
    );
    it('does not treat a mutation name used as a query alias as account access', () => {
        const { run } = invoke('futureCatalogExport');
        Object.assign(parsed.info, { path: { key: 'login' }, operation: { name: { value: 'Login' } } });
        expect(run).toThrow();
        expect(invoke('login', 'Query').run).toThrow();
    });
    it('passes only the active-cart delivery email setter through for guests', () => {
        const { run, next } = invoke('setActiveOrderDeliveryEmail', 'Mutation');
        expect(run).not.toThrow();
        expect(next.handle).toHaveBeenCalledTimes(1);
        expect(invoke('setActiveOrderDeliveryEmail', 'Query').run).toThrow();
    });
    it('passes the placed-order payment mutation only through its explicitly authorized entry', () => {
        expect(invoke('addPaymentToModifiedOrder', 'Mutation').run).not.toThrow();
        expect(invoke('addPaymentToModifiedOrder', 'Query').run).toThrow();
        expect(invoke('orderAdditionalPaymentQuote', 'Mutation').run).toThrow();
    });
    it.each([
        'activeCustomer',
        'storefrontBranding',
        'storefrontContent',
        'activeChannel',
        'imageStudioConfig',
    ])('preserves public account bootstrap: %s', field => expect(invoke(field).run).not.toThrow());
    it.each(['login', 'registerCustomerWithReferral', 'requestPasswordReset', 'resetPassword'])(
        'preserves account mutation: %s',
        async field => {
            const { run, next } = invoke(field, 'Mutation');
            await expect(firstValueFrom(run())).resolves.toBe('resolver-data');
            expect(next.handle).toHaveBeenCalledTimes(1);
        },
    );
    it('blocks the unaudited built-in registration mutation', () => {
        expect(invoke('registerCustomerAccount', 'Mutation').run).toThrow();
        expect(invoke('registerCustomerAccount', 'Mutation', 'customer-user').run).toThrow();
    });
    it('passes anonymous cart operations to their existing resolver ownership checks', () => {
        for (const field of [
            'storefrontCart',
            'activeOrder',
            'eligibleShippingMethods',
            'eligiblePaymentMethods',
            'nextOrderStates',
            'myDigitalDeliveryContents',
        ]) {
            expect(invoke(field).run).not.toThrow();
        }
        for (const field of [
            'applyStorefrontCartCommand',
            'recoverStorefrontCartCommand',
            'addStorefrontCartItem',
            'setStorefrontCartLineQuantity',
            'removeStorefrontCartLines',
            'setStorefrontCartLinesSelected',
            'setAllStorefrontCartLinesSelected',
            'beginStorefrontCheckout',
            'prepareStorefrontCartPayment',
            'reopenStorefrontCart',
            'addItemToOrder',
            'adjustOrderLine',
            'removeOrderLine',
            'removeAllOrderLines',
            'applyCouponCode',
            'removeCouponCode',
            'setCustomerForOrder',
            'setOrderShippingAddress',
            'setOrderBillingAddress',
            'unsetOrderShippingAddress',
            'unsetOrderBillingAddress',
            'setOrderShippingMethod',
            'setOrderCustomFields',
            'transitionOrderToState',
            'addPaymentToOrder',
            'createStorefrontOrderConfirmationToken',
            'claimDigitalDelivery',
            'setActiveOrderDeliveryEmail',
        ]) {
            expect(invoke(field, 'Mutation').run).not.toThrow();
        }
    });
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

describe('store email registration policy', () => {
    it.each(['registerCustomerWithReferral', 'verifyCustomerAccount', 'refreshCustomerVerification'])(
        'blocks direct %s before any resolver action when email is disabled',
        async field => {
            readAuthSettings.mockResolvedValue({ emailPasswordEnabled: false });
            for (const userId of [undefined, 'authenticated-customer']) {
                const { run, next } = invoke(field, 'Mutation', userId);
                await expect(firstValueFrom(run())).rejects.toThrow();
                expect(next.handle).not.toHaveBeenCalled();
            }
            expect(readAuthSettings).toHaveBeenCalledWith(expect.anything(), ctx);
            expect(ctx.setReplicationMode).toHaveBeenCalledWith('master');
        },
    );

    it.each(['registerCustomerWithReferral', 'verifyCustomerAccount', 'refreshCustomerVerification'])(
        'allows %s only after the active-store policy succeeds',
        async field => {
            const { run, next } = invoke(field, 'Mutation');
            await expect(firstValueFrom(run())).resolves.toBe('resolver-data');
            expect(readAuthSettings).toHaveBeenCalledTimes(1);
            expect(next.handle).toHaveBeenCalledTimes(1);
        },
    );

    it('fails closed when the current store settings cannot be read', async () => {
        readAuthSettings.mockRejectedValue(new Error('Synthetic settings read failure'));
        const { run, next } = invoke('verifyCustomerAccount', 'Mutation');
        await expect(firstValueFrom(run())).rejects.toThrow('Synthetic settings read failure');
        expect(next.handle).not.toHaveBeenCalled();
    });

    it('keeps Admin and Google authentication on their existing paths', async () => {
        for (const [field, apiType] of [
            ['verifyCustomerAccount', 'admin'],
            ['authenticate', 'shop'],
        ]) {
            const { run, next } = invoke(field, 'Mutation', undefined, apiType);
            await expect(firstValueFrom(run())).resolves.toBe('resolver-data');
            expect(next.handle).toHaveBeenCalledTimes(1);
        }
        expect(readAuthSettings).not.toHaveBeenCalled();
    });
});

import { describe, expect, it, vi } from 'vitest';

import { isOperationalStorefront, StorefrontActivationService } from './storefront-activation.service';

function createService(
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | null,
    sellerId = 'merchant-seller',
    channelId = 'channel-1',
    hasActivePrimaryDomain = false,
    isPublished = false,
) {
    const profileRepository = {
        findOne: vi.fn().mockResolvedValue(status ? { id: 'profile-1', status, isPublished } : null),
    };
    const domainRepository = {
        exists: vi.fn().mockResolvedValue(hasActivePrimaryDomain),
    };
    const connection = {
        getRepository: vi.fn().mockReturnValueOnce(profileRepository).mockReturnValue(domainRepository),
    };
    const channelService = {
        findOne: vi.fn().mockResolvedValue({ id: channelId, sellerId }),
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default', sellerId: 'platform-seller' }),
    };
    return new StorefrontActivationService(connection as any, channelService as any);
}

describe('StorefrontActivationService', () => {
    it('never treats the platform management center as an operating store', () => {
        expect(
            isOperationalStorefront({
                isDefaultChannel: true,
                status: 'ACTIVE',
                isPlatformOwned: true,
                isPublished: true,
                hasVerifiedPrimaryDomain: true,
            }),
        ).toBe(false);
    });
    it.each(['DRAFT', 'SUSPENDED'] as const)('blocks Shop API access for %s stores', async status => {
        await expect(
            createService(status).assertActive({ apiType: 'shop', channelId: 'channel-1' } as any),
        ).rejects.toThrow();
    });

    it('allows active stores', async () => {
        await expect(
            createService('ACTIVE', 'merchant-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).resolves.toBeUndefined();
    });

    it('blocks merchant Channels when provisioning left no managed profile', async () => {
        await expect(
            createService(null).assertActive({ apiType: 'shop', channelId: 'default' } as any),
        ).rejects.toThrow();
    });

    it('does not affect Admin API operations', async () => {
        await expect(
            createService('DRAFT').assertActive({ apiType: 'admin', channelId: 'channel-1' } as any),
        ).resolves.toBeUndefined();
    });

    it('blocks platform-owned regional Channels without a managed profile', async () => {
        await expect(
            createService(null, 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('keeps verified platform-owned drafts closed until preview is explicitly enabled', async () => {
        await expect(
            createService('DRAFT', 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow('店铺暂未开放');
    });

    it('opens a merchant draft only when public preview and its primary domain are active', async () => {
        await expect(
            createService('DRAFT', 'merchant-seller', 'channel-1', true, true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).resolves.toBeUndefined();
        await expect(
            createService('DRAFT', 'merchant-seller', 'channel-1', false, true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
        await expect(
            createService('SUSPENDED', 'merchant-seller', 'channel-1', true, true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('blocks platform-owned regional drafts without an active primary domain', async () => {
        await expect(
            createService('DRAFT', 'platform-seller').assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('blocks suspended platform-owned regional stores even with a verified domain', async () => {
        await expect(
            createService('SUSPENDED', 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('allows only the actual default Channel without a managed profile', async () => {
        await expect(
            createService(null, 'platform-seller', 'default').assertActive(
                {
                    apiType: 'shop',
                    channelId: 'default',
                } as any,
                'activeCustomer',
            ),
        ).resolves.toBeUndefined();
    });
});

describe('public preview payment boundary', () => {
    const ctx = { apiType: 'admin', channelId: 'channel-1' } as any;
    const order = { id: 'order-1', salesChannelId: 'channel-1', currencyCode: 'CNY' } as any;
    const controlled = {
        id: 'test',
        enabled: true,
        code: 'controlled-test-payment-platform',
        handler: { code: 'controlled-test-payment-handler' },
        checker: { code: 'controlled-test-payment-checker' },
    } as any;
    function fixture() {
        const current = { status: 'DRAFT', isPublished: true };
        const primary = { active: true };
        const receipt = { intent: null as any };
        const checkout = { validate: null as any };
        const quotes = { filter: null as any };
        const methods = {
            getActivePaymentMethods: vi.fn().mockResolvedValue([controlled]),
            registerEligibilityFilter: vi.fn((_id, filter) => {
                quotes.filter = filter;
            }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity.name === 'StoreProfile') return { findOne: vi.fn(() => Promise.resolve(current)) };
                if (entity.name === 'StoreDomain')
                    return { exists: vi.fn(() => Promise.resolve(primary.active)) };
                return { findOne: vi.fn(() => Promise.resolve(receipt.intent)) };
            }),
        };
        const service = new StorefrontActivationService(
            connection as any,
            {
                findOne: vi.fn((_ctx, id) => Promise.resolve({ id, sellerId: 'platform-seller' })),
                getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default', sellerId: 'platform-seller' }),
            } as any,
            {
                registerCheckoutValidator: vi.fn((_id, validate) => {
                    checkout.validate = validate;
                }),
            } as any,
            methods as any,
        );
        service.onApplicationBootstrap();
        return { service, current, primary, receipt, checkout, quotes, methods };
    }
    it('uses authoritative transitions without a cached Seller exception', async () => {
        const h = fixture();
        expect(await h.service.getAccessMode(ctx)).toBe('PREVIEW');
        h.current.isPublished = false;
        expect(await h.service.getAccessMode(ctx)).toBe('CLOSED');
        h.current.isPublished = true;
        h.primary.active = false;
        expect(await h.service.getAccessMode(ctx)).toBe('CLOSED');
        h.current.status = 'ACTIVE';
        expect(await h.service.getAccessMode(ctx)).toBe('CLOSED');
        h.primary.active = true;
        expect(await h.service.getAccessMode(ctx)).toBe('LIVE');
        h.current.status = 'SUSPENDED';
        expect(await h.service.getAccessMode(ctx)).toBe('CLOSED');
    });
    it('returns the precise GraphQL closure code and keeps default catalog/new payment closed', async () => {
        const h = fixture();
        await expect(
            h.service.assertActive({ ...ctx, apiType: 'shop', channelId: 'default' }, 'products'),
        ).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED', extensions: { code: 'STOREFRONT_CLOSED' } });
        await expect(
            h.service.assertActive({ ...ctx, apiType: 'shop', channelId: 'default' }, 'activeCustomer'),
        ).resolves.toBeUndefined();
        await expect(h.service.assertNewRealPaymentAllowed(ctx, 'default')).rejects.toThrow('真实付款');
    });
    it('accepts explicit simulated checkout but rejects real startup even in Admin and forged test metadata', async () => {
        const h = fixture();
        await expect(h.checkout.validate(ctx, order, { method: controlled.code })).resolves.toEqual({});
        await expect(
            h.checkout.validate(ctx, order, { method: 'real', metadata: { public: { testPayment: true } } }),
        ).resolves.toMatchObject({ error: expect.stringContaining('显式测试支付') });
        await expect(
            h.checkout.validate(ctx, order, { method: controlled.code }, 'manual'),
        ).resolves.toMatchObject({ error: expect.stringContaining('显式测试支付') });
        h.current.status = 'ACTIVE';
        await expect(h.checkout.validate(ctx, order, { method: 'real' })).resolves.toEqual({});
    });
    it.each(['disabled', 'wrong-code', 'wrong-handler', 'missing-checker'])(
        'rejects %s simulated method configuration',
        async mismatch => {
            const h = fixture();
            const method = {
                ...controlled,
                handler: { ...controlled.handler },
                checker: { ...controlled.checker },
            };
            if (mismatch === 'disabled') method.enabled = false;
            if (mismatch === 'wrong-code') method.code = 'controlled-test-payment-legacy';
            if (mismatch === 'wrong-handler') method.handler.code = 'real-handler';
            if (mismatch === 'missing-checker') method.checker = null;
            h.methods.getActivePaymentMethods.mockResolvedValue([method]);
            await expect(h.checkout.validate(ctx, order, { method: method.code })).resolves.toMatchObject({
                error: expect.any(String),
            });
            expect(await h.quotes.filter(ctx, order, [{ code: method.code, isEligible: true }])).toEqual([]);
        },
    );
    it('limits quotes to the configured controlled method, then restores live methods and blocks missing sale ownership', async () => {
        const h = fixture();
        const quoted = [
            { code: controlled.code, isEligible: true },
            { code: 'real', isEligible: true },
        ];
        expect(await h.quotes.filter(ctx, order, quoted)).toEqual([quoted[0]]);
        h.current.status = 'ACTIVE';
        expect(await h.quotes.filter(ctx, order, quoted)).toEqual(quoted);
        await expect(
            h.service.assertOrderPaymentAllowed(
                ctx,
                { ...order, salesChannelId: 'other' },
                { method: 'real', metadata: {} },
            ),
        ).rejects.toThrow('不属于');
        expect(await h.quotes.filter(ctx, { ...order, salesChannelId: null }, quoted)).toEqual([]);
        expect(await h.quotes.filter(ctx, { ...order, salesChannelId: 'other' }, quoted)).toEqual([]);
    });
    it('keeps a confirmed simulation from becoming new real funding even after returning LIVE', async () => {
        const h = fixture();
        h.current.status = 'ACTIVE';
        const simulated = {
            ...order,
            payments: [{ method: controlled.code, metadata: { public: { testPayment: true } } }],
        };
        await expect(h.checkout.validate(ctx, simulated, { method: 'real' })).resolves.toMatchObject({
            error: expect.stringContaining('模拟付款订单'),
        });
        await expect(
            h.service.assertNewRealPaymentAllowed(ctx, order.salesChannelId, simulated),
        ).rejects.toThrow('模拟付款订单');
        expect(await h.quotes.filter(ctx, simulated, [{ code: 'real', isEligible: true }])).toEqual([]);
    });

    it.each(
        ['Settled', 'Authorized', 'Declined', 'Cancelled'].flatMap(state =>
            ['native-method-only', 'server-marker-only'].map(identity => ({ state, identity })),
        ),
    )(
        'keeps $state persisted test identity via $identity from new funding after LIVE',
        async ({ state, identity }) => {
            const h = fixture();
            h.current.status = 'ACTIVE';
            const persisted = {
                ...order,
                payments: [
                    {
                        state,
                        method: identity === 'native-method-only' ? controlled.code : 'historical-provider',
                        metadata: identity === 'server-marker-only' ? { public: { testPayment: true } } : {},
                    },
                ],
            };
            await expect(h.checkout.validate(ctx, persisted, { method: 'real' })).resolves.toMatchObject({
                error: expect.stringContaining('模拟付款订单'),
            });
            await expect(
                h.checkout.validate(ctx, persisted, { method: 'manual-real' }, 'manual'),
            ).resolves.toMatchObject({
                error: expect.stringContaining('模拟付款订单'),
            });
            await expect(
                h.service.assertNewRealPaymentAllowed(ctx, order.salesChannelId, persisted),
            ).rejects.toThrow('模拟付款订单');
            expect(await h.quotes.filter(ctx, persisted, [{ code: 'real', isEligible: true }])).toEqual([]);
        },
    );

    it('does not turn client flags on a new real payment input into persisted test identity', async () => {
        const h = fixture();
        h.current.status = 'ACTIVE';
        const persisted = { ...order, payments: [{ state: 'Settled', method: 'real', metadata: {} }] };
        await expect(
            h.checkout.validate(ctx, persisted, {
                method: 'real',
                metadata: { public: { testPayment: true } },
            }),
        ).resolves.toEqual({});
        await expect(
            h.service.assertNewRealPaymentAllowed(ctx, order.salesChannelId, persisted),
        ).resolves.toBeUndefined();
        expect(await h.quotes.filter(ctx, persisted, [{ code: 'real', isEligible: true }])).toEqual([
            { code: 'real', isEligible: true },
        ]);
    });
    it('preserves a signed issued-intent receipt after closure, without permitting proof-only or manual bypasses', async () => {
        const { configureUsdtPaymentProofSecret, createUsdtPaymentProof } =
            await import('./usdt/usdt-payment-proof.js');
        configureUsdtPaymentProofSecret('synthetic-preview-boundary-proof-secret-long-enough');
        const h = fixture();
        h.current.isPublished = false;
        const payload = {
            channelId: 'channel-1',
            orderId: 'order-1',
            quoteId: 'quote-1',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 1000,
            transactionId: 'a'.repeat(64),
            usdtAmount: '1.000001',
            receivingAddressFingerprint: 'b'.repeat(64),
            expiresAt: Date.now() + 60000,
        };
        const input = { method: 'usdt-trc20', metadata: { proof: createUsdtPaymentProof(payload) } };
        await expect(h.checkout.validate(ctx, order, input)).resolves.toMatchObject({
            error: expect.any(String),
        });
        h.receipt.intent = {
            status: 'PENDING',
            blockNumber: 10,
            blockTimestamp: new Date(),
            receivedUsdtAmount: payload.usdtAmount,
            expectedUsdtAmount: payload.usdtAmount,
            receivingAddressFingerprint: payload.receivingAddressFingerprint,
            quote: { fiatAmount: payload.fiatAmount, fiatCurrencyCode: payload.fiatCurrencyCode },
        };
        await expect(h.checkout.validate(ctx, order, input)).resolves.toEqual({});
        await expect(
            h.checkout.validate(
                ctx,
                {
                    ...order,
                    payments: [{ method: controlled.code, metadata: { public: { testPayment: true } } }],
                },
                input,
            ),
        ).resolves.toEqual({});
        for (const payment of [
            { method: controlled.code, metadata: {} },
            { method: 'historical-provider', metadata: { public: { testPayment: true } } },
        ]) {
            await expect(h.checkout.validate(ctx, { ...order, payments: [payment] }, input)).resolves.toEqual(
                {},
            );
        }
        await expect(h.checkout.validate(ctx, order, input, 'manual')).resolves.toMatchObject({
            error: expect.any(String),
        });
        h.receipt.intent.receivedUsdtAmount = '0.000001';
        await expect(h.checkout.validate(ctx, order, input)).resolves.toMatchObject({
            error: expect.any(String),
        });
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi, ShopApiError } from './api';
import { MarketConfig } from './types';

const market: MarketConfig = {
    code: 'cn-mainland',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: '中国大陆',
};

function mockGraphQlResponse(data: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function jsonRequestBody(init?: RequestInit): string {
    if (typeof init?.body !== 'string') throw new TypeError('Expected a JSON request body');
    return init.body;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ShopApi storefront mutations', () => {
    it('surfaces the specific native authentication failure returned by the Shop API', async () => {
        const fetchMock = mockGraphQlResponse({
            login: {
                __typename: 'InvalidCredentialsError',
                errorCode: 'INVALID_CREDENTIALS_ERROR',
                message: 'The provided credentials are invalid',
                authenticationError: 'STOREFRONT_ACCOUNT_NOT_FOUND',
            },
        });

        await expect(new ShopApi(market).login('missing@example.com', 'password')).rejects.toEqual(
            expect.objectContaining<Partial<ShopApiError>>({
                errorCode: 'INVALID_CREDENTIALS_ERROR',
                authenticationError: 'STOREFRONT_ACCOUNT_NOT_FOUND',
            }),
        );
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('... on InvalidCredentialsError { authenticationError }');
    });

    it('limits the initial storefront product request to 16 items', async () => {
        const fetchMock = mockGraphQlResponse({ products: { items: [] } });

        await new ShopApi(market).products();

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('query StorefrontProducts($options: ProductListOptions)');
        expect(request.query).toContain('saleableStockLevel');
        expect(request.query).not.toMatch(/\bstockLevel\b/);
        expect(request.variables).toEqual({ options: { take: 16, sort: { name: 'ASC' } } });
    });

    it('requests localized content with Vendure language query context', async () => {
        const fetchMock = mockGraphQlResponse({
            storefrontContent: [],
            storefrontContentSettings: { heroAutoplayIntervalSeconds: 8 },
        });

        await expect(new ShopApi(market, 'en').storefrontContent()).resolves.toEqual({
            blocks: [],
            coupons: [],
            flashSales: [],
            systemAnnouncements: [],
            settings: { heroAutoplayIntervalSeconds: 8, configuredBlockTypes: [] },
        });

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('languageCode=en'),
            expect.objectContaining({ method: 'POST' }),
        );
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('currencyCode=CNY'),
            expect.objectContaining({ method: 'POST' }),
        );
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('storefrontContent');
        expect(request.query).toContain('storefrontContentSettings');
        expect(request.query).toContain('activeStorefrontCoupons');
        expect(request.query).toContain('activeStorefrontFlashSales');
        expect(request.query).not.toMatch(/activeStorefrontFlashSales\s*\{\s*id\s+name\b/u);
        expect(request.query).toContain('activeSystemAnnouncements');
        expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
            'vendure-token': 'cn-mainland',
        });
    });

    it('switches the active checkout order to the selected settlement currency', async () => {
        const order = {
            __typename: 'Order',
            id: 'order-1',
            code: 'ORDER-1',
            state: 'AddingItems',
            totalQuantity: 1,
            subTotalWithTax: 5991,
            shippingWithTax: 0,
            totalWithTax: 5991,
            currencyCode: 'MYR',
            lines: [],
            discounts: [],
            taxSummary: [],
            couponCodes: [],
            customFields: {},
        };
        const fetchMock = mockGraphQlResponse({ setCurrencyCodeForOrder: order });

        await expect(new ShopApi(market).setCurrencyForOrder('MYR')).resolves.toEqual(order);

        const request = JSON.parse(jsonRequestBody(fetchMock.mock.calls[0][1])) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('setCurrencyCodeForOrder');
        expect(request.variables).toEqual({ currencyCode: 'MYR' });
    });

    it('creates a server-locked USDT checkout quote', async () => {
        const quote = {
            id: 'quote-1',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 10_000,
            fiatPerUsdtRate: 7.2,
            markupPercent: 1,
            usdtAmount: 14.027823,
            source: 'Binance P2P',
            network: 'TRC20',
            tokenContractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            receivingAddress: 'TReceivingAddress',
            receivingAddressFingerprint: 'a'.repeat(64),
            paymentStatus: 'PENDING',
            transactionId: null,
            settledAt: null,
            createdAt: '2026-08-26T00:00:00.000Z',
            expiresAt: '2026-08-26T00:10:00.000Z',
        };
        const fetchMock = mockGraphQlResponse({ createStorefrontUsdtCheckoutQuote: quote });

        await expect(new ShopApi(market).createUsdtCheckoutQuote()).resolves.toEqual(quote);
        const request = JSON.parse(jsonRequestBody(fetchMock.mock.calls[0][1])) as { query: string };
        expect(request.query).toContain('createStorefrontUsdtCheckoutQuote');
        expect(request.query).toContain('usdtAmount');
        expect(request.query).toContain('receivingAddressFingerprint');
        expect(request.query).toContain('paymentStatus');
    });

    it('falls back to a five-second carousel interval when settings are absent', async () => {
        mockGraphQlResponse({ storefrontContent: [] });

        await expect(new ShopApi(market).storefrontContent()).resolves.toEqual({
            blocks: [],
            coupons: [],
            flashSales: [],
            systemAnnouncements: [],
            settings: { heroAutoplayIntervalSeconds: 5, configuredBlockTypes: [] },
        });
    });

    it('falls back to the legacy storefront content query when optional commerce fields are unavailable', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        errors: [
                            {
                                message: 'Cannot query field "activeStorefrontCoupons" on type "Query".',
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            storefrontContent: [],
                            storefrontContentSettings: { heroAutoplayIntervalSeconds: 7 },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            );
        vi.stubGlobal('fetch', fetchMock);

        await expect(new ShopApi(market).storefrontContent()).resolves.toEqual({
            blocks: [],
            coupons: [],
            flashSales: [],
            systemAnnouncements: [],
            settings: { heroAutoplayIntervalSeconds: 7, configuredBlockTypes: [] },
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const modernRequest = JSON.parse(jsonRequestBody(fetchMock.mock.calls[0][1])) as { query: string };
        const legacyRequest = JSON.parse(jsonRequestBody(fetchMock.mock.calls[1][1])) as { query: string };
        expect(modernRequest.query).toContain('activeStorefrontCoupons');
        expect(legacyRequest.query).toContain('query StorefrontContentLegacy');
        expect(legacyRequest.query).not.toContain('activeStorefrontCoupons');
        expect(legacyRequest.query).not.toContain('configuredBlockTypes');
    });

    it('does not hide non-schema storefront content failures behind the legacy fallback', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ errors: [{ message: 'Internal server error' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(new ShopApi(market).storefrontContent()).rejects.toThrow('Internal server error');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reuses the Vendure bearer token for subsequent requests and clears it on logout', async () => {
        const responseBody = JSON.stringify({ data: { storefrontContent: [] } });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(responseBody, {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                        'vendure-auth-token': 'anonymous-session-token',
                    },
                }),
            )
            .mockResolvedValueOnce(
                new Response(responseBody, {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: { logout: { success: true } } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(responseBody, {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);

        await api.storefrontContent();
        await api.storefrontContent();
        await api.logout();
        await api.storefrontContent();

        expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('authorization');
        expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
            authorization: 'Bearer anonymous-session-token',
        });
        expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
            authorization: 'Bearer anonymous-session-token',
        });
        expect(fetchMock.mock.calls[3][1]?.headers).not.toHaveProperty('authorization');
    });

    it('passes the original order quantity when adding an item again', async () => {
        const cart = {
            id: 'cart-1',
            revision: 4,
            state: 'OPEN',
            projectedRevision: 4,
            totalQuantity: 3,
            selectedLineCount: 1,
            selectedQuantity: 3,
            selectionState: 'ALL',
            lines: [],
            checkoutOrder: null,
        };
        const fetchMock = mockGraphQlResponse({ addStorefrontCartItem: cart });

        await new ShopApi(market).addItem('variant-1', 3, 3);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('$quantity: Int!');
        expect(request.variables).toEqual({
            productVariantId: 'variant-1',
            quantity: 3,
            expectedRevision: 3,
        });
    });

    it('surfaces a structured coupon error', async () => {
        mockGraphQlResponse({
            applyCouponCode: {
                __typename: 'CouponCodeInvalidError',
                errorCode: 'COUPON_CODE_INVALID_ERROR',
                message: 'Coupon code is invalid',
            },
        });

        await expect(new ShopApi(market).applyCouponCode('INVALID')).rejects.toEqual(
            expect.objectContaining<Partial<ShopApiError>>({
                name: 'ShopApiError',
                errorCode: 'COUPON_CODE_INVALID_ERROR',
            }),
        );
    });

    it('claims and applies an owned coupon by server IDs without exposing an internal code', async () => {
        const customerCoupon = {
            id: 'customer-coupon-1',
            campaignId: 'campaign-1',
            campaignName: '新客满减',
            campaignKind: 'ORDER_FIXED',
            status: 'AVAILABLE',
            minimumSpend: 10_000,
            discountAmount: 2_000,
            discountRate: null,
            claimedAt: '2026-08-25T00:00:00.000Z',
            validFrom: '2026-08-25T00:00:00.000Z',
            validUntil: '2026-09-01T00:00:00.000Z',
            lockedAt: null,
            usedAt: null,
            returnedAt: null,
            expiredAt: null,
            lockedOrderId: null,
            usedOrderId: null,
            returnCount: 0,
            usable: true,
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: { claimStorefrontCoupon: customerCoupon } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            applyStorefrontCoupon: {
                                ...customerCoupon,
                                status: 'LOCKED',
                                lockedOrderId: 'order-1',
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            );
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);

        await expect(api.claimCoupon('campaign-1')).resolves.toMatchObject({ id: 'customer-coupon-1' });
        await expect(api.applyCustomerCoupon('customer-coupon-1')).resolves.toMatchObject({
            status: 'LOCKED',
        });

        const claimRequest = JSON.parse(jsonRequestBody(fetchMock.mock.calls[0][1])) as {
            query: string;
            variables: Record<string, unknown>;
        };
        const applyRequest = JSON.parse(jsonRequestBody(fetchMock.mock.calls[1][1])) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(claimRequest.variables).toEqual({ campaignId: 'campaign-1' });
        expect(applyRequest.variables).toEqual({ id: 'customer-coupon-1' });
        expect(`${claimRequest.query}${applyRequest.query}`).not.toContain('couponCode');
    });

    it('loads immutable coupon usage records separately from current coupon status', async () => {
        const fetchMock = mockGraphQlResponse({
            myStorefrontCouponUsageRecords: [
                {
                    id: 'allocation-1',
                    customerCouponId: 'coupon-1',
                    campaignId: 'campaign-1',
                    campaignName: '退款返券活动',
                    campaignKind: 'ORDER_FIXED',
                    status: 'REFUNDED',
                    currencyCode: 'CNY',
                    minimumSpend: 10_000,
                    discountAmount: 1_000,
                    discountRate: null,
                    savedAmount: 1_000,
                    usedAt: '2026-08-26T00:00:00.000Z',
                    refundedAt: '2026-08-27T00:00:00.000Z',
                    orderId: 'order-1',
                    orderCode: 'T0001',
                },
            ],
        });

        await expect(new ShopApi(market).myCouponUsageRecords()).resolves.toEqual([
            expect.objectContaining({ id: 'allocation-1', status: 'REFUNDED', orderCode: 'T0001' }),
        ]);
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('myStorefrontCouponUsageRecords');
        expect(request.query).toContain('savedAmount');
    });

    it('loads eligible payment methods for the active order', async () => {
        const fetchMock = mockGraphQlResponse({
            eligiblePaymentMethods: [
                {
                    id: 'payment-1',
                    code: '测试支付',
                    name: '测试支付',
                    description: '',
                    isEligible: true,
                    eligibilityMessage: null,
                },
            ],
        });

        await expect(new ShopApi(market).eligiblePaymentMethods()).resolves.toHaveLength(1);
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('eligiblePaymentMethods');
        expect(request.query).toContain('isEligible');
    });

    it('submits payment metadata and returns the placed order', async () => {
        const fetchMock = mockGraphQlResponse({
            addPaymentToOrder: {
                __typename: 'Order',
                id: 'order-1',
                code: 'T0001',
                state: 'PaymentAuthorized',
                lines: [],
            },
        });

        await expect(new ShopApi(market).addPaymentToOrder('测试支付')).resolves.toMatchObject({
            code: 'T0001',
            state: 'PaymentAuthorized',
        });
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({ input: { method: '测试支付', metadata: {} } });
    });

    it('surfaces a structured payment decline', async () => {
        mockGraphQlResponse({
            addPaymentToOrder: {
                __typename: 'PaymentDeclinedError',
                errorCode: 'PAYMENT_DECLINED_ERROR',
                message: 'Payment was declined',
            },
        });

        await expect(new ShopApi(market).addPaymentToOrder('测试支付')).rejects.toEqual(
            expect.objectContaining<Partial<ShopApiError>>({
                name: 'ShopApiError',
                errorCode: 'PAYMENT_DECLINED_ERROR',
            }),
        );
    });

    it('creates a signed token before payment and retrieves the guest order with it', async () => {
        const tokenFetch = mockGraphQlResponse({
            createStorefrontOrderConfirmationToken: {
                token: 'signed-confirmation-token',
                expiresAt: '2026-08-20T12:00:00.000Z',
            },
        });

        await expect(new ShopApi(market).createOrderConfirmationToken()).resolves.toEqual({
            token: 'signed-confirmation-token',
            expiresAt: '2026-08-20T12:00:00.000Z',
        });
        expect(String(tokenFetch.mock.calls[0][1]?.body)).toContain('createStorefrontOrderConfirmationToken');

        const fetchMock = mockGraphQlResponse({
            storefrontOrderByConfirmationToken: {
                id: 'order-1',
                code: 'T0001',
                state: 'PaymentAuthorized',
                lines: [],
            },
        });

        await expect(
            new ShopApi(market).orderByConfirmationToken('signed-confirmation-token'),
        ).resolves.toMatchObject({ code: 'T0001' });
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({ token: 'signed-confirmation-token' });
    });

    it('updates the customer note through active-order custom fields', async () => {
        const fetchMock = mockGraphQlResponse({
            setOrderCustomFields: {
                __typename: 'Order',
                id: 'order-1',
                customFields: { customerNote: '请放在门口' },
            },
        });

        await expect(new ShopApi(market).setOrderNote('请放在门口')).resolves.toMatchObject({
            customFields: { customerNote: '请放在门口' },
        });

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('setOrderCustomFields(input: $input)');
        expect(request.query).toContain('customFields { customerNote deliveryEmail }');
        expect(request.variables).toEqual({
            input: { customFields: { customerNote: '请放在门口' } },
        });
    });

    it('stores the normalized digital delivery email on the active order', async () => {
        const fetchMock = mockGraphQlResponse({
            setOrderCustomFields: {
                __typename: 'Order',
                id: 'order-1',
                customFields: { deliveryEmail: 'buyer@example.com' },
            },
        });

        await expect(new ShopApi(market).setDeliveryEmail('buyer@example.com')).resolves.toMatchObject({
            customFields: { deliveryEmail: 'buyer@example.com' },
        });

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('mutation SetStorefrontDeliveryEmail');
        expect(request.query).toContain('customFields { customerNote deliveryEmail }');
        expect(request.variables).toEqual({
            input: { customFields: { deliveryEmail: 'buyer@example.com' } },
        });
    });

    it('updates an address with its id and default state', async () => {
        const address = {
            id: 'address-1',
            fullName: 'Test User',
            phoneNumber: '123456',
            streetLine1: 'Main Street',
            streetLine2: '',
            city: 'Shanghai',
            province: 'Shanghai',
            postalCode: '200000',
            defaultShippingAddress: true,
            defaultBillingAddress: false,
            country: { code: 'CN', name: 'China' },
        };
        const fetchMock = mockGraphQlResponse({ updateCustomerAddress: address });

        await new ShopApi(market).updateAddress({
            id: address.id,
            fullName: address.fullName,
            phoneNumber: address.phoneNumber,
            streetLine1: address.streetLine1,
            streetLine2: address.streetLine2,
            city: address.city,
            province: address.province,
            postalCode: address.postalCode,
            countryCode: address.country.code,
            defaultShippingAddress: true,
        });

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: { input: Record<string, unknown> };
        };
        expect(request.variables.input).toMatchObject({
            id: 'address-1',
            countryCode: 'CN',
            defaultShippingAddress: true,
        });
    });

    it('registers a customer with the complete account input', async () => {
        const fetchMock = mockGraphQlResponse({
            registerCustomerWithReferral: { __typename: 'Success', success: true },
        });

        await new ShopApi(market).registerCustomerAccount(
            {
                emailAddress: 'customer@example.com',
                firstName: 'Test',
                lastName: 'Customer',
                password: 'secure-password',
            },
            'INVITE88',
            'POSTER',
        );

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('registerCustomerWithReferral(input: $input');
        expect(request.variables).toEqual({
            input: {
                emailAddress: 'customer@example.com',
                firstName: 'Test',
                lastName: 'Customer',
                password: 'secure-password',
            },
            inviteCode: 'INVITE88',
            source: 'POSTER',
        });
    });

    it('passes the email address when requesting a password reset', async () => {
        const fetchMock = mockGraphQlResponse({
            requestPasswordReset: { __typename: 'Success', success: true },
        });

        await new ShopApi(market).requestPasswordReset('customer@example.com');

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({ emailAddress: 'customer@example.com' });
    });

    it('passes account verification tokens, optional passwords and resend addresses to Vendure', async () => {
        const resendFetchMock = mockGraphQlResponse({
            refreshCustomerVerification: { __typename: 'Success', success: true },
        });
        const api = new ShopApi(market);

        await api.refreshCustomerVerification('customer@example.com');
        let request = JSON.parse(String(resendFetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({ emailAddress: 'customer@example.com' });

        const verificationFetchMock = mockGraphQlResponse({
            verifyCustomerAccount: { __typename: 'CurrentUser', id: '1' },
        });
        await api.verifyCustomerAccount('verify+token');
        request = JSON.parse(String(verificationFetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('verifyCustomerAccount(token: $token, password: $password)');
        expect(request.variables).toEqual({ token: 'verify+token' });

        const passwordVerificationFetchMock = mockGraphQlResponse({
            verifyCustomerAccount: { __typename: 'CurrentUser', id: '1' },
        });
        await api.verifyCustomerAccount('admin-created-token', 'new-secure-password');
        request = JSON.parse(String(passwordVerificationFetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({
            token: 'admin-created-token',
            password: 'new-secure-password',
        });
    });

    it('surfaces an expired password reset token', async () => {
        mockGraphQlResponse({
            resetPassword: {
                __typename: 'PasswordResetTokenExpiredError',
                errorCode: 'PASSWORD_RESET_TOKEN_EXPIRED_ERROR',
                message: 'Password reset token has expired',
            },
        });

        await expect(new ShopApi(market).resetPassword('expired-token', 'new-password')).rejects.toEqual(
            expect.objectContaining<Partial<ShopApiError>>({
                name: 'ShopApiError',
                errorCode: 'PASSWORD_RESET_TOKEN_EXPIRED_ERROR',
            }),
        );
    });

    it('loads a sorted search page with one catalog request and preserves server order', async () => {
        const fetchMock = mockGraphQlResponse({
            storefrontCatalog: {
                totalItems: 22,
                items: [
                    { id: 'product-2', name: 'Second product', variants: [] },
                    { id: 'product-1', name: 'First product', variants: [] },
                ],
            },
        });

        const page = await new ShopApi(market).searchProducts('audit', 'price-asc', 20, 10, 'collection-1');

        const catalogRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(catalogRequest.variables).toEqual({
            input: {
                term: 'audit',
                collectionId: 'collection-1',
                sort: 'PRICE_ASC',
                inStockOnly: false,
                skip: 20,
                take: 10,
            },
        });
        expect(page.totalItems).toBe(22);
        expect(page.items.map(product => product.id)).toEqual(['product-2', 'product-1']);
    });

    it('passes filters and AbortSignal to the single catalog request', async () => {
        const fetchMock = mockGraphQlResponse({ storefrontCatalog: { totalItems: 0, items: [] } });
        const controller = new AbortController();

        await new ShopApi(market).catalog(
            {
                collectionId: 'collection-1',
                fulfillmentType: 'digital',
                inStockOnly: true,
                minPriceWithTax: 1000,
                maxPriceWithTax: 5000,
            },
            controller.signal,
        );

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: { input: Record<string, unknown> };
        };
        expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
        expect(request.variables.input).toMatchObject({
            collectionId: 'collection-1',
            fulfillmentType: 'DIGITAL',
            inStockOnly: true,
            minPriceWithTax: 1000,
            maxPriceWithTax: 5000,
            skip: 0,
            take: 12,
        });
    });

    it('falls back to native search when the custom catalog schema is unavailable', async () => {
        const fallbackProducts = [
            {
                id: 'product-2',
                createdAt: '2026-01-02T00:00:00.000Z',
                name: 'Digital product',
                variants: [
                    {
                        priceWithTax: 2400,
                        saleableStockLevel: null,
                        customFields: { fulfillmentType: 'digital' },
                    },
                ],
            },
            {
                id: 'product-4',
                createdAt: '2026-01-04T00:00:00.000Z',
                name: 'Higher price',
                variants: [
                    {
                        priceWithTax: 2500,
                        saleableStockLevel: 8,
                        customFields: { fulfillmentType: 'physical' },
                    },
                ],
            },
            {
                id: 'product-3',
                createdAt: '2026-01-03T00:00:00.000Z',
                name: 'Out of stock',
                variants: [
                    {
                        priceWithTax: 2200,
                        saleableStockLevel: 0,
                        customFields: { fulfillmentType: 'physical' },
                    },
                ],
            },
            {
                id: 'product-1',
                createdAt: '2026-01-01T00:00:00.000Z',
                name: 'Lower price',
                variants: [
                    {
                        priceWithTax: 1500,
                        saleableStockLevel: 5,
                        customFields: { fulfillmentType: 'physical' },
                    },
                ],
            },
        ];
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
            const request = JSON.parse(jsonRequestBody(init)) as { query: string };
            if (request.query.includes('query StorefrontCatalog(')) {
                return new Response(
                    JSON.stringify({
                        errors: [{ message: 'Unknown type "StorefrontCatalogInput".' }],
                    }),
                    { status: 400, headers: { 'content-type': 'application/json' } },
                );
            }
            if (request.query.includes('query StorefrontNativeCatalog')) {
                return new Response(
                    JSON.stringify({
                        data: {
                            search: {
                                totalItems: 4,
                                items: [
                                    { productId: 'product-1' },
                                    { productId: 'product-2' },
                                    { productId: 'product-3' },
                                    { productId: 'product-4' },
                                ],
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (request.query.includes('query StorefrontProductsByIds')) {
                return new Response(JSON.stringify({ data: { products: { items: fallbackProducts } } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error('Unexpected GraphQL request');
        });
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const input = {
            collectionId: 'collection-1',
            sort: 'price-desc' as const,
            fulfillmentType: 'physical' as const,
            inStockOnly: true,
            minPriceWithTax: 1000,
            maxPriceWithTax: 2600,
        };

        const firstPage = await api.catalog(input);
        const secondPage = await api.catalog(input);

        expect(firstPage.totalItems).toBe(2);
        expect(firstPage.items.map(product => product.id)).toEqual(['product-4', 'product-1']);
        expect(secondPage.items.map(product => product.id)).toEqual(['product-4', 'product-1']);
        const requests = fetchMock.mock.calls.map(
            call =>
                JSON.parse(jsonRequestBody(call[1])) as {
                    query: string;
                    variables: Record<string, unknown>;
                },
        );
        expect(requests.filter(request => request.query.includes('query StorefrontCatalog('))).toHaveLength(
            1,
        );
        expect(
            requests.filter(request => request.query.includes('query StorefrontNativeCatalog')),
        ).toHaveLength(2);
        expect(requests[1].variables).toEqual({
            input: {
                collectionId: 'collection-1',
                groupByProduct: true,
                inStock: true,
                skip: 0,
                take: 100,
            },
        });
    });

    it('does not hide unrelated catalog errors behind the native fallback', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ errors: [{ message: 'Catalog permission denied' }] }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(new ShopApi(market).catalog({ collectionId: 'collection-1' })).rejects.toThrow(
            'Catalog permission denied',
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('loads product sales in bounded batches and removes duplicate ids', async () => {
        const productIds = Array.from({ length: 101 }, (_, index) => `product-${index + 1}`);
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
            const request = JSON.parse(jsonRequestBody(init)) as {
                variables: { productIds: string[] };
            };
            return new Response(
                JSON.stringify({
                    data: {
                        storefrontProductSales: request.variables.productIds.map((productId, index) => ({
                            productId,
                            quantity: index + 1,
                        })),
                    },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        const sales = await new ShopApi(market).productSales([...productIds, productIds[0]]);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sales['product-1']).toBe(1);
        expect(sales['product-100']).toBe(100);
        expect(sales['product-101']).toBe(1);
    });

    it('loads product history by id and preserves recent order', async () => {
        const fetchMock = mockGraphQlResponse({
            products: {
                items: [
                    { id: 'product-1', name: 'First product', variants: [] },
                    { id: 'product-2', name: 'Second product', variants: [] },
                ],
            },
        });

        const products = await new ShopApi(market).productsByIds(['product-2', 'product-1', 'product-2']);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({
            options: {
                take: 2,
                filter: { id: { in: ['product-2', 'product-1'] } },
            },
        });
        expect(products.map(product => product.id)).toEqual(['product-2', 'product-1']);
    });

    it('uses order summaries for the active customer query', async () => {
        const fetchMock = mockGraphQlResponse({ activeCustomer: null });

        await expect(new ShopApi(market).activeCustomer()).resolves.toBeNull();

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('query StorefrontCustomer');
        expect(request.query).toContain('checkoutShipping { methodName }');
        expect(request.query).not.toContain('digitalDeliveries');
        expect(request.query).not.toContain('taxSummary');
        expect(request.query).not.toContain('handlerCode');
    });

    it('paginates and filters customer orders on the server', async () => {
        const fetchMock = mockGraphQlResponse({
            activeCustomer: { orders: { totalItems: 14, items: [] } },
        });

        const page = await new ShopApi(market).customerOrders(10, 10, [
            'PaymentAuthorized',
            'PaymentSettled',
        ]);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('orders(options: $options)');
        expect(request.query).toContain('checkoutFulfillment { containsDigitalProducts }');
        expect(request.query).not.toContain('digitalDeliveries');
        expect(request.query).not.toContain('taxSummary');
        expect(request.query).not.toContain('handlerCode');
        expect(request.variables).toEqual({
            options: {
                skip: 10,
                take: 10,
                sort: { orderPlacedAt: 'DESC' },
                filter: { state: { in: ['PaymentAuthorized', 'PaymentSettled'] } },
            },
        });
        expect(page.totalItems).toBe(14);
    });

    it('combines order status and code filters', async () => {
        const fetchMock = mockGraphQlResponse({
            activeCustomer: { orders: { totalItems: 1, items: [] } },
        });

        await new ShopApi(market).customerOrders(0, 10, ['Shipped'], '  AB-123  ');

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: { options: Record<string, unknown> };
        };
        expect(request.variables.options).toMatchObject({
            filter: {
                _and: [{ state: { in: ['Shipped'] } }, { code: { contains: 'AB-123' } }],
            },
        });
    });

    it('loads an order independently by id', async () => {
        const fetchMock = mockGraphQlResponse({ order: null });

        await expect(new ShopApi(market).order('order-31')).resolves.toBeNull();

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(request.variables).toEqual({ id: 'order-31' });
    });

    it('requests tax and persisted checkout shipping details with an order', async () => {
        const fetchMock = mockGraphQlResponse({ order: null });

        await new ShopApi(market).order('order-32');

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('taxSummary { description taxRate taxBase taxTotal }');
        expect(request.query).not.toContain('handlerCode');
        expect(request.query).toContain('checkoutShipping {');
        expect(request.query).toContain('estimateMinDays');
        expect(request.query).toContain('freeShippingApplied');
    });

    it('cancels only through the customer-authorized order mutation with an explicit reason', async () => {
        const cancelledOrder = { id: 'order-33', state: 'Cancelled' };
        const fetchMock = mockGraphQlResponse({ cancelMyAuthorizedOrder: cancelledOrder });

        await expect(
            new ShopApi(market).cancelMyAuthorizedOrder('order-33', 'Changed my mind'),
        ).resolves.toEqual(cancelledOrder);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('mutation CancelMyAuthorizedOrder');
        expect(request.variables).toEqual({ orderId: 'order-33', reason: 'Changed my mind' });
    });

    it('requests calculator metadata for eligible shipping methods', async () => {
        const methods = [
            {
                id: 'shipping-1',
                code: 'standard',
                name: 'Standard',
                description: '',
                priceWithTax: 1200,
                metadata: { estimateMinDays: 2, estimateMaxDays: 4 },
            },
        ];
        const fetchMock = mockGraphQlResponse({ eligibleShippingMethods: methods });

        await expect(new ShopApi(market).eligibleShippingMethods()).resolves.toEqual(methods);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('priceWithTax metadata');
    });

    it('loads customer after-sales timelines', async () => {
        const fetchMock = mockGraphQlResponse({ myAfterSalesRequests: [] });

        await expect(new ShopApi(market).afterSalesRequests()).resolves.toEqual([]);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('query MyAfterSalesRequests');
        expect(request.query).toContain('events {');
        expect(request.query).toContain('lineAmountWithTax');
    });

    it('submits after-sales selections without client-calculated money values', async () => {
        const response = { id: 'request-1', state: 'PENDING' };
        const fetchMock = mockGraphQlResponse({ createAfterSalesRequest: response });
        const input = {
            orderId: 'order-1',
            type: 'REFUND_ONLY' as const,
            reason: 'DAMAGED' as const,
            description: 'The product arrived damaged.',
            items: [{ orderLineId: 'line-1', quantity: 1 }],
        };

        await expect(new ShopApi(market).createAfterSalesRequest(input)).resolves.toEqual(response);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('mutation CreateAfterSalesRequest');
        expect(request.variables).toEqual({ input });
        expect(JSON.stringify(request.variables)).not.toContain('requestedAmount');
    });

    it('loads only server-approved product reviews through the public review query', async () => {
        const response = { items: [], totalItems: 0, averageRating: 4.25 };
        const fetchMock = mockGraphQlResponse({ storefrontProductReviews: response });

        await expect(new ShopApi(market).productReviews('product-1')).resolves.toEqual(response);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('query StorefrontProductReviews');
        expect(request.query).toContain('verifiedPurchase');
        expect(request.query).toContain('averageRating');
        expect(request.variables).toEqual({ productId: 'product-1' });
    });

    it('loads customer review moderation states', async () => {
        const fetchMock = mockGraphQlResponse({ myStorefrontReviews: [] });

        await expect(new ShopApi(market).myReviews()).resolves.toEqual([]);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('query MyStorefrontReviews');
        expect(request.query).toContain('merchantResponse');
    });

    it('loads review candidates from the authenticated server query', async () => {
        const response = [{ orderLineId: 'line-7', productId: 'product-3' }];
        const fetchMock = mockGraphQlResponse({ myStorefrontReviewCandidates: response });

        await expect(new ShopApi(market).reviewCandidates()).resolves.toEqual(response);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('query MyStorefrontReviewCandidates');
        expect(request.query).toContain('orderLineId');
        expect(request.query).toContain('fulfillmentType');
    });

    it('submits reviews without client-controlled customer or moderation fields', async () => {
        const response = { id: 'review-1', state: 'PENDING' };
        const fetchMock = mockGraphQlResponse({ submitStorefrontReview: response });
        const input = {
            orderLineId: 'line-1',
            rating: 5,
            title: 'Very useful',
            body: 'The product was clear, practical, and easy to use.',
        };

        await expect(new ShopApi(market).submitReview(input)).resolves.toEqual(response);

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('mutation SubmitStorefrontReview');
        expect(request.variables).toEqual({ input });
        expect(JSON.stringify(request.variables)).not.toContain('customerId');
        expect(JSON.stringify(request.variables)).not.toContain('state');
    });

    it('returns exact order shortcut counts', async () => {
        const fetchMock = mockGraphQlResponse({
            activeCustomer: {
                pending: { totalItems: 2 },
                shipping: { totalItems: 3 },
                receiving: { totalItems: 4 },
            },
        });

        await expect(new ShopApi(market).customerOrderCounts()).resolves.toEqual({
            pending: 2,
            shipping: 3,
            receiving: 4,
        });

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('pending: orders');
        expect(request.query).toContain('shipping: orders');
        expect(request.query).toContain('receiving: orders');
    });
});

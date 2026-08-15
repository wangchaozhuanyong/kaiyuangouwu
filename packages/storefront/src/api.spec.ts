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

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ShopApi storefront mutations', () => {
    it('requests localized content with Vendure language query context', async () => {
        const fetchMock = mockGraphQlResponse({ storefrontContent: [] });

        await new ShopApi(market, 'en').storefrontContent();

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('languageCode=en'),
            expect.objectContaining({ method: 'POST' }),
        );
        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
        expect(request.query).toContain('storefrontContent');
        expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
            'vendure-token': 'cn-mainland',
        });
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
        expect(request.query).toContain('customFields { customerNote }');
        expect(request.variables).toEqual({
            input: { customFields: { customerNote: '请放在门口' } },
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
            registerCustomerAccount: { __typename: 'Success', success: true },
        });

        await new ShopApi(market).registerCustomerAccount({
            emailAddress: 'customer@example.com',
            firstName: 'Test',
            lastName: 'Customer',
            password: 'secure-password',
        });

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(request.query).toContain('registerCustomerAccount(input: $input)');
        expect(request.variables).toEqual({
            input: {
                emailAddress: 'customer@example.com',
                firstName: 'Test',
                lastName: 'Customer',
                password: 'secure-password',
            },
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

    it('uses server search pagination and preserves relevance order', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            search: {
                                totalItems: 22,
                                items: [{ productId: 'product-2' }, { productId: 'product-1' }],
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            products: {
                                items: [
                                    { id: 'product-1', name: 'First product', variants: [] },
                                    { id: 'product-2', name: 'Second product', variants: [] },
                                ],
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            );
        vi.stubGlobal('fetch', fetchMock);

        const page = await new ShopApi(market).searchProducts('audit', 'price-asc', 20, 10, 'collection-1');

        const searchRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        const productRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(searchRequest.variables).toEqual({
            input: {
                term: 'audit',
                collectionId: 'collection-1',
                groupByProduct: true,
                skip: 20,
                take: 10,
                sort: { price: 'ASC' },
            },
        });
        expect(productRequest.variables).toEqual({
            options: {
                take: 2,
                filter: { id: { in: ['product-2', 'product-1'] } },
            },
        });
        expect(page.totalItems).toBe(22);
        expect(page.items.map(product => product.id)).toEqual(['product-2', 'product-1']);
    });

    it('loads every search page before client-side filtering', async () => {
        const firstPageIds = Array.from({ length: 100 }, (_, index) => `product-${index + 1}`);
        const firstPageProducts = firstPageIds.map(id => ({ id, name: id, variants: [] }));
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            search: {
                                totalItems: 101,
                                items: firstPageIds.map(productId => ({ productId })),
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ data: { products: { items: firstPageProducts } } }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            search: {
                                totalItems: 101,
                                items: [{ productId: 'product-101' }],
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: {
                            products: {
                                items: [{ id: 'product-101', name: 'product-101', variants: [] }],
                            },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            );
        vi.stubGlobal('fetch', fetchMock);

        const products = await new ShopApi(market).searchAllProducts('', 'name', 'collection-1');

        const secondSearchRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as {
            variables: { input: Record<string, unknown> };
        };
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(secondSearchRequest.variables.input).toMatchObject({
            collectionId: 'collection-1',
            skip: 100,
            take: 100,
            sort: { name: 'ASC' },
        });
        expect(products).toHaveLength(101);
        expect(products.at(-1)?.id).toBe('product-101');
    });

    it('loads product sales in bounded batches and removes duplicate ids', async () => {
        const productIds = Array.from({ length: 101 }, (_, index) => `product-${index + 1}`);
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const request = JSON.parse(String(init?.body)) as { variables: { productIds: string[] } };
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

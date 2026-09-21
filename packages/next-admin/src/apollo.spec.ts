import { gql } from '@apollo/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    channelRequestContext,
    clearAuthSession,
    client,
    getActiveChannelToken,
    getLocalizedAdminApiUrl,
    openAdminOrderEvents,
    prepareAuthSession,
    setInitialActiveChannel,
    switchActiveChannel,
    uploadAdminFiles,
} from './apollo';
import { GET_INVENTORY_OVERVIEW } from './graphql/catalog-admin.graphql';

function storage(values: Record<string, string> = {}) {
    const items = new Map(Object.entries(values));
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
    };
}

const request = vi.fn<typeof fetch>();
beforeEach(() => {
    vi.stubGlobal('localStorage', storage({ 'vendure-active-channel-token': 'legacy-shared-store' }));
    vi.stubGlobal(
        'sessionStorage',
        storage({
            'vendure-auth-token': 'test-session',
            'vendure-active-channel-token': 'store-a',
        }),
    );
    vi.stubGlobal('fetch', request);
    request.mockReset();
});
afterEach(async () => {
    await client.clearStore();
    vi.unstubAllGlobals();
});

describe('admin channel request routing', () => {
    it('keeps channel-specific payment report rows separate in the cache', () => {
        const query = gql`
            query PaymentReportCache {
                storePaymentDetails {
                    items {
                        id
                        channelId
                        channelCode
                        amount
                    }
                }
            }
        `;
        const data = {
            storePaymentDetails: {
                items: [
                    {
                        __typename: 'StorePaymentDetail',
                        id: '27',
                        channelId: '16',
                        channelCode: 'sim-audit-0913',
                        amount: 113,
                    },
                    {
                        __typename: 'StorePaymentDetail',
                        id: '27',
                        channelId: '1',
                        channelCode: '__default_channel__',
                        amount: 113,
                    },
                ],
            },
        };
        client.cache.writeQuery({ query, data });
        expect(client.cache.readQuery({ query })).toEqual(data);
    });

    it('retains every stock movement implementation when reading the inventory cache', () => {
        const movements = ['StockAdjustment', 'Allocation', 'Sale', 'Cancellation', 'Return', 'Release'].map(
            (__typename, index) => ({
                __typename,
                id: `movement-${index}`,
                createdAt: '2026-09-14T07:00:00.000Z',
                type: ['ADJUSTMENT', 'ALLOCATION', 'SALE', 'CANCELLATION', 'RETURN', 'RELEASE'][index],
                quantity: index - 2,
            }),
        );
        const variables = { variantOptions: { take: 20 } };
        const data = {
            productVariants: {
                totalItems: 1,
                items: [
                    {
                        __typename: 'ProductVariant',
                        id: 'inventory-variant',
                        name: '测试规格',
                        sku: 'SIM-STOCK',
                        enabled: true,
                        price: 100,
                        currencyCode: 'CNY',
                        trackInventory: 'TRUE',
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: true,
                        product: { __typename: 'Product', id: 'inventory-product', name: '测试商品' },
                        stockLevels: [],
                        stockMovements: { totalItems: 6, items: movements },
                    },
                ],
            },
            globalSettings: { outOfStockThreshold: 0, trackInventory: true },
        };
        client.cache.writeQuery({ query: GET_INVENTORY_OVERVIEW, variables, data });
        const read = client.cache.readQuery<typeof data>({ query: GET_INVENTORY_OVERVIEW, variables });
        expect(read?.productVariants.items[0].stockMovements.items).toEqual(movements);
    });

    it('opens one authenticated event stream with an abort signal and replay cursor, without URL credentials', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://admin.example.test' } });
        request.mockResolvedValue(new Response(null, { headers: { 'content-type': 'text/event-stream' } }));
        const signal = new AbortController().signal;
        await openAdminOrderEvents('store-b', signal, 'instance:12');
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toBe('https://admin.example.test/admin-order-events');
        expect(request.mock.calls[0][1]).toMatchObject({
            signal,
            credentials: 'include',
            headers: {
                'vendure-token': 'store-b',
                authorization: 'Bearer test-session',
                'Last-Event-ID': 'instance:12',
                accept: 'text/event-stream',
            },
        });
        expect(sessionStorage.getItem('vendure-active-channel-token')).toBe('store-a');
        expect(localStorage.getItem('vendure-active-channel-token')).toBe('legacy-shared-store');
    });

    it('uses Simplified Chinese as the display language for all Admin API requests', () => {
        const url = new URL(getLocalizedAdminApiUrl(), 'http://localhost');
        expect(url.searchParams.get('displayLanguageCode')).toBe('zh_Hans');
    });

    it('uploads multipart files into the selected store and retains the session', async () => {
        request.mockResolvedValue(Response.json({ data: { createAssets: [{ id: 'asset' }] } }));
        const file = new File(['image'], 'icon.png', { type: 'image/png' });
        const result = await uploadAdminFiles('mutation Upload { createAssets { id } }', [file], files => ({
            input: files.map(file => ({ file })),
        }));
        expect(result).toEqual({ createAssets: [{ id: 'asset' }] });
        const init = request.mock.calls[0][1]!;
        expect(
            new URL(String(request.mock.calls[0][0]), 'http://localhost').searchParams.get(
                'displayLanguageCode',
            ),
        ).toBe('zh_Hans');
        expect(init.headers).toEqual({
            'vendure-token': 'store-a',
            authorization: 'Bearer test-session',
            'Apollo-Require-Preflight': 'true',
        });
        expect(init.credentials).toBe('include');
        const form = init.body as FormData;
        expect(JSON.parse(String(form.get('map')))).toEqual({ '0': ['variables.input.0.file'] });
        expect((form.get('0') as File).name).toBe('icon.png');
    });

    it('refuses to upload without a selected store instead of falling back to the default', async () => {
        sessionStorage.removeItem('vendure-active-channel-token');
        await expect(
            uploadAdminFiles('mutation Upload { createAssets { id } }', [], () => ({})),
        ).rejects.toThrow('请先选择店铺');
        expect(request).not.toHaveBeenCalled();
    });

    it('uploads into an explicitly selected source library without changing the active store', async () => {
        request.mockResolvedValue(Response.json({ data: { createAssets: [{ id: 'shared-asset' }] } }));
        const file = new File(['image'], 'shared.png', { type: 'image/png' });
        await uploadAdminFiles(
            'mutation Upload { createAssets { id } }',
            [file],
            files => ({ input: files.map(upload => ({ file: upload })) }),
            { channelToken: 'store-shared' },
        );
        expect(request.mock.calls[0][1]?.headers).toMatchObject({
            'vendure-token': 'store-shared',
            authorization: 'Bearer test-session',
        });
        expect(sessionStorage.getItem('vendure-active-channel-token')).toBe('store-a');
    });

    it('uses explicit store context without changing the globally selected store', async () => {
        request.mockResolvedValue(Response.json({ data: { activeChannel: { id: 'b' } } }));
        await client.query({
            query: gql`
                query BrandChannelProbe {
                    activeChannel {
                        id
                    }
                }
            `,
            fetchPolicy: 'no-cache',
            context: channelRequestContext('store-b'),
        });
        expect(request.mock.calls[0][1]?.headers).toMatchObject({
            'vendure-token': 'store-b',
            authorization: 'Bearer test-session',
        });
        expect(sessionStorage.getItem('vendure-active-channel-token')).toBe('store-a');
    });

    it('keeps ordinary requests scoped to the current store', async () => {
        request.mockResolvedValue(Response.json({ data: { activeChannel: { id: 'a' } } }));
        await client.query({
            query: gql`
                query CurrentChannelProbe {
                    activeChannel {
                        id
                    }
                }
            `,
            fetchPolicy: 'no-cache',
        });
        expect(request.mock.calls[0][1]?.headers).toMatchObject({ 'vendure-token': 'store-a' });
    });

    it('keeps the active store scoped to the current browser tab', () => {
        expect(getActiveChannelToken()).toBe('store-a');
        expect(localStorage.getItem('vendure-active-channel-token')).toBe('legacy-shared-store');

        setInitialActiveChannel('store-b');

        expect(getActiveChannelToken()).toBe('store-b');
        expect(sessionStorage.getItem('vendure-active-channel-token')).toBe('store-b');
        expect(localStorage.getItem('vendure-active-channel-token')).toBe('legacy-shared-store');
    });

    it('commits a store switch only after the selected Channel reload succeeds', async () => {
        const resetStore = vi.spyOn(client, 'resetStore').mockResolvedValueOnce([]);

        await switchActiveChannel('store-b');

        expect(resetStore).toHaveBeenCalledTimes(1);
        expect(getActiveChannelToken()).toBe('store-b');
        resetStore.mockRestore();
    });

    it('restores the previous store when reloading the selected Channel fails', async () => {
        const resetStore = vi
            .spyOn(client, 'resetStore')
            .mockRejectedValueOnce(new Error('forbidden target Channel'))
            .mockResolvedValueOnce([]);

        await expect(switchActiveChannel('store-b')).rejects.toThrow('forbidden target Channel');

        expect(resetStore).toHaveBeenCalledTimes(2);
        expect(getActiveChannelToken()).toBe('store-a');
        resetStore.mockRestore();
    });

    it('clears tab-scoped and legacy shared selections when authentication changes', () => {
        prepareAuthSession(false);
        expect(sessionStorage.getItem('vendure-active-channel-token')).toBeNull();
        expect(localStorage.getItem('vendure-active-channel-token')).toBeNull();

        setInitialActiveChannel('store-b');
        localStorage.setItem('vendure-active-channel-token', 'legacy-store');
        clearAuthSession();

        expect(sessionStorage.getItem('vendure-active-channel-token')).toBeNull();
        expect(localStorage.getItem('vendure-active-channel-token')).toBeNull();
    });
});

describe('paginated list cache', () => {
    it.each(['products', 'orders', 'assets', 'collections'])(
        'keeps %s pages, page sizes and other field arguments distinct',
        field => {
            const query = gql`query CachedList($options: ListOptions, $parentId: ID) {
                ${field}(options: $options, parentId: $parentId) { totalItems items { id } }
            }`;
            const first = { options: { skip: 0, take: 20, sort: { id: 'ASC' } }, parentId: 'a' };
            const second = { ...first, options: { ...first.options, skip: 20 } };
            const data = (id: string) => ({ [field]: { totalItems: 40, items: [{ id }] } });
            client.cache.writeQuery({ query, variables: first, data: data('first') });
            expect(client.cache.readQuery({ query, variables: second })).toBeNull();
            expect(
                client.cache.readQuery({
                    query,
                    variables: {
                        ...first,
                        options: { ...first.options, take: 10 },
                    },
                }),
            ).toBeNull();
            expect(client.cache.readQuery({ query, variables: { ...first, parentId: 'b' } })).toBeNull();
            client.cache.writeQuery({ query, variables: second, data: data('second') });
            expect(client.cache.readQuery({ query, variables: first })).toEqual(data('first'));
            expect(client.cache.readQuery({ query, variables: second })).toEqual(data('second'));
        },
    );
});

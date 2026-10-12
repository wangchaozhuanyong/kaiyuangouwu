import { gql } from '@apollo/client';
import { describe, expect, it, vi } from 'vitest';
import { AdminQueryRuntime, getQueryRuntime, resourceIdentity } from './admin-query-runtime';

const policy = { staleTime: 30_000, pollInterval: 0, stage: 0 };
const owner = (fetch: () => Promise<unknown>, active = true, refetchPeers = false) => ({
    page: '/catalog/list',
    active,
    loading: false,
    hasData: true,
    refetchPeers,
    fetch,
});

describe('shared admin query runtime', () => {
    it('only notifies owners of a changed resource, including shared and shell owners', () => {
        const runtime = new AdminQueryRuntime();
        const fetch = async () => null;
        runtime.register('products', 'catalog', owner(fetch), policy);
        runtime.register('orders', 'orders', { ...owner(fetch), page: '/orders' }, policy);
        runtime.register('products', 'dashboard', { ...owner(fetch), page: '/dashboard' }, policy);
        runtime.register('channel', 'shell', { ...owner(fetch), page: '@shell' }, policy);
        const catalog = vi.fn(),
            orders = vi.fn(),
            dashboard = vi.fn(),
            resource = vi.fn();
        runtime.subscribePage('/catalog/list', catalog);
        const unsubscribe = runtime.subscribePage('/orders', orders);
        runtime.subscribePage('/dashboard', dashboard);
        runtime.subscribeResource('products', resource);
        const orderVersion = runtime.pageSnapshot('/orders');
        runtime.update('products', 'catalog', { loading: true });
        expect(catalog).toHaveBeenCalledTimes(1);
        expect(dashboard).toHaveBeenCalledTimes(1);
        expect(resource).toHaveBeenCalledTimes(1);
        expect(orders).not.toHaveBeenCalled();
        expect(runtime.pageSnapshot('/orders')).toBe(orderVersion);
        runtime.update('channel', 'shell', { loading: true });
        expect(orders).toHaveBeenCalledTimes(1);
        expect(runtime.state('/orders').refreshing).toBe(true);
        unsubscribe();
        runtime.invalidate(key => key === 'orders');
        expect(orders).toHaveBeenCalledTimes(1);
    });

    it('merges a burst of event refreshes and reads only affected domains, keeping manual refresh complete', async () => {
        const runtime = new AdminQueryRuntime();
        let finish!: () => void;
        const orders = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            )
            .mockResolvedValue('latest');
        const products = vi.fn(async () => 'catalog');
        runtime.register('orders', 'orders', owner(orders), { ...policy, domains: ['orders'] });
        runtime.register('products', 'products', owner(products), { ...policy, domains: ['catalog'] });
        const initial = runtime.refreshPage('/catalog/list');
        await Promise.resolve();
        runtime.invalidateDomains(['orders']);
        const events = Array.from({ length: 50 }, () =>
            runtime.refreshPage('/catalog/list', 'event', ['orders']),
        );
        expect(events.every(work => work === events[0])).toBe(true);
        finish();
        await initial;
        await Promise.all(events);
        expect(orders).toHaveBeenCalledTimes(2);
        expect(products).toHaveBeenCalledTimes(1);
        await runtime.refreshPage('/catalog/list');
        expect(products).toHaveBeenCalledTimes(2);
    });

    it('moves resource ownership without leaving the previous page subscribed to its state', () => {
        const runtime = new AdminQueryRuntime();
        const remove = runtime.register(
            'product',
            'editor',
            owner(async () => null),
            policy,
        );
        runtime.update('product', 'editor', { page: '/catalog/products/1' });
        expect(runtime.state('/catalog/list').resources).toBe(0);
        expect(runtime.state('/catalog/products/1').resources).toBe(1);
        remove();
        expect(runtime.state('/catalog/products/1').resources).toBe(0);
    });
    it('keys by document, variables, request context and scope rather than operation name', () => {
        const first = gql`
            query Product($id: ID!) {
                product(id: $id) {
                    id
                    name
                }
            }
        `;
        const different = gql`
            query Product($id: ID!) {
                product(id: $id) {
                    id
                    slug
                }
            }
        `;
        const key = resourceIdentity(
            first,
            { id: '1', filter: { enabled: true, name: 'test' } },
            { headers: { language: 'zh' } },
            'a',
        );
        expect(
            resourceIdentity(
                first,
                { filter: { name: 'test', enabled: true }, id: '1' },
                { headers: { language: 'zh' } },
                'a',
            ),
        ).toBe(key);
        expect(resourceIdentity(different, { id: '1' }, {}, 'a')).not.toBe(key);
        expect(resourceIdentity(first, { id: '2' }, {}, 'a')).not.toBe(key);
        expect(resourceIdentity(first, { id: '1' }, {}, 'b')).not.toBe(key);
        expect(resourceIdentity(first, { id: '1' }, { headers: { language: 'en' } }, 'a')).not.toBe(key);
    });
    it('joins refresh clicks and callers reading the same resource', async () => {
        const runtime = new AdminQueryRuntime();
        let finish!: (data: unknown) => void;
        const fetch = vi.fn(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        runtime.register('products', 'list', owner(fetch), policy);
        runtime.register('products', 'widget', owner(fetch), policy);
        const first = runtime.refreshResource('products');
        const second = runtime.refreshResource('products');
        expect(first).toBe(second);
        await Promise.resolve();
        expect(fetch).toHaveBeenCalledTimes(1);
        finish({ data: 'latest' });
        expect(await second).toEqual({ data: 'latest' });
        expect(await first).toEqual({ data: 'latest' });
        expect(runtime.state('/catalog/list').refreshing).toBe(false);
    });
    it('refreshes opted-in active observables once, joins callers and excludes inactive and other-scope owners', async () => {
        const runtime = new AdminQueryRuntime();
        let finishFirst!: (result: unknown) => void;
        let finishSecond!: (result: unknown) => void;
        const firstFetch = vi.fn(
            () =>
                new Promise(resolve => {
                    finishFirst = resolve;
                }),
        );
        const secondFetch = vi.fn(
            () =>
                new Promise(resolve => {
                    finishSecond = resolve;
                }),
        );
        const inactiveFetch = vi.fn(async () => 'inactive');
        const otherScopeFetch = vi.fn(async () => 'other scope');
        runtime.register('store-a|products', 'list', owner(firstFetch, true, true), policy);
        runtime.register('store-a|products', 'widget', owner(secondFetch, true, true), policy);
        runtime.register('store-a|products', 'hidden', owner(inactiveFetch, false, true), policy);
        runtime.register('store-b|products', 'other-store', owner(otherScopeFetch, true, true), policy);

        const first = runtime.refreshResource('store-a|products');
        const second = runtime.refreshResource('store-a|products');
        expect(first).toBe(second);
        await Promise.resolve();
        expect(firstFetch).toHaveBeenCalledTimes(1);
        expect(secondFetch).toHaveBeenCalledTimes(1);
        expect(inactiveFetch).not.toHaveBeenCalled();
        expect(otherScopeFetch).not.toHaveBeenCalled();

        const firstResult = { data: 'list receipt' };
        finishFirst(firstResult);
        await Promise.resolve();
        expect(runtime.state('/catalog/list').refreshing).toBe(true);
        expect(runtime.refreshResource('store-a|products')).toBe(first);
        finishSecond({ data: 'widget receipt' });
        expect(await first).toBe(firstResult);
        expect(await second).toBe(firstResult);
        expect(runtime.state('/catalog/list').refreshing).toBe(false);
        expect(inactiveFetch).not.toHaveBeenCalled();
        expect(otherScopeFetch).not.toHaveBeenCalled();
    });
    it('waits for all active owners after a synchronous failure and allows a later retry', async () => {
        const runtime = new AdminQueryRuntime(() => 10_000);
        const error = new Error('network unavailable');
        let finishSecond!: (result: unknown) => void;
        const firstFetch = vi
            .fn()
            .mockImplementationOnce(() => {
                throw error;
            })
            .mockResolvedValue({ data: 'recovered list' });
        const secondFetch = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        finishSecond = resolve;
                    }),
            )
            .mockResolvedValue({ data: 'recovered widget' });
        runtime.register('products', 'list', owner(firstFetch, true, true), policy);
        runtime.register('products', 'widget', owner(secondFetch, true, true), policy);

        const first = runtime.refreshResource('products');
        const outcome = first.catch(reason => reason);
        await Promise.resolve();
        expect(firstFetch).toHaveBeenCalledTimes(1);
        expect(secondFetch).toHaveBeenCalledTimes(1);
        expect(runtime.state('/catalog/list').refreshing).toBe(true);
        expect(runtime.refreshResource('products')).toBe(first);
        finishSecond({ data: 'other receipt' });
        expect(await outcome).toBe(error);
        expect(runtime.state('/catalog/list').refreshing).toBe(false);
        expect(runtime.isStale('products')).toBe(true);

        expect(await runtime.refreshResource('products')).toEqual({ data: 'recovered list' });
        expect(firstFetch).toHaveBeenCalledTimes(2);
        expect(secondFetch).toHaveBeenCalledTimes(2);
        expect(runtime.isStale('products')).toBe(false);
    });
    it('preserves the first observable result when a peer uses a rejecting error policy', async () => {
        const runtime = new AdminQueryRuntime();
        const error = new Error('partial GraphQL response');
        const result = { data: undefined, error };
        const firstFetch = vi.fn(async () => result);
        const secondFetch = vi.fn(async () => {
            throw error;
        });
        runtime.register('products', 'list', owner(firstFetch, true, true), policy);
        runtime.register('products', 'widget', owner(secondFetch, true, true), policy);
        expect(await runtime.refreshResource('products')).toBe(result);
        expect(firstFetch).toHaveBeenCalledTimes(1);
        expect(secondFetch).toHaveBeenCalledTimes(1);
    });
    it('keeps non-deduplicated reads on one owner when callbacks differ', async () => {
        const runtime = new AdminQueryRuntime();
        const result = { data: 'one request' };
        const firstFetch = vi.fn(async () => result);
        const secondFetch = vi.fn(async () => ({ data: 'duplicate' }));
        runtime.register('store-a|read:settings', 'first', owner(firstFetch), policy);
        runtime.register('store-a|read:settings', 'second', owner(secondFetch), policy);
        expect(await runtime.refreshResource('store-a|read:settings')).toBe(result);
        expect(firstFetch).toHaveBeenCalledTimes(1);
        expect(secondFetch).not.toHaveBeenCalled();
    });
    it('invalidates a hidden resource without fetching until its owner resumes', async () => {
        const runtime = new AdminQueryRuntime();
        const fetch = vi.fn(async () => 'new');
        runtime.register('products', 'list', owner(fetch, false), policy);
        await runtime.refreshPage('/catalog/list');
        expect(fetch).not.toHaveBeenCalled();
        runtime.invalidate();
        runtime.update('products', 'list', { active: true });
        await runtime.refreshPage('/catalog/list', 'activation');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('refreshes current dependent IDs after parents commit and reports partial failures', async () => {
        const runtime = new AdminQueryRuntime();
        const sequence: string[] = [];
        const old = runtime.register(
            'cost:old',
            'cost',
            owner(async () => sequence.push('old-cost')),
            { ...policy, stage: 2 },
        );
        runtime.register(
            'products',
            'list',
            owner(async () => {
                sequence.push('products');
                old();
                runtime.register(
                    'cost:new',
                    'cost-new',
                    owner(async () => {
                        sequence.push('new-cost');
                        throw new Error('cost offline');
                    }),
                    { ...policy, stage: 2 },
                );
            }),
            { ...policy, stage: 1 },
        );
        runtime.register(
            'status',
            'status',
            owner(async () => sequence.push('status')),
            policy,
        );
        const results = await runtime.refreshPage('/catalog/list');
        expect(sequence).toEqual(['status', 'products', 'new-cost']);
        expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
        expect(runtime.state('/catalog/list').refreshing).toBe(false);
    });
    it('does not refresh fresh resources on reactivation, but manual refresh always runs', async () => {
        let now = 10_000;
        const runtime = new AdminQueryRuntime(() => now);
        const fetch = vi.fn(async () => 'new');
        runtime.register('products', 'list', owner(fetch), policy);
        await runtime.refreshPage('/catalog/list');
        await runtime.refreshPage('/catalog/list', 'activation');
        expect(fetch).toHaveBeenCalledTimes(1);
        now += 30_001;
        await runtime.refreshPage('/catalog/list', 'activation');
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('removes ownership on tab close and keeps different Apollo clients isolated', () => {
        const runtime = new AdminQueryRuntime();
        const remove = runtime.register(
            'products',
            'list',
            owner(async () => null),
            policy,
        );
        remove();
        expect(runtime.state('/catalog/list').resources).toBe(0);
        expect(getQueryRuntime({})).not.toBe(getQueryRuntime({}));
    });
    it('does not consume a write invalidation with a read started before that write', async () => {
        const runtime = new AdminQueryRuntime(() => 10_000);
        let finish!: () => void;
        const fetch = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            )
            .mockResolvedValue('after-write');
        runtime.register('products', 'list', owner(fetch), policy);
        const oldRead = runtime.refreshPage('/catalog/list');
        await Promise.resolve();
        runtime.invalidate();
        const writeReadback = runtime.refreshPage('/catalog/list', 'write');
        finish();
        await oldRead;
        await writeReadback;
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(runtime.isStale('products')).toBe(false);
    });
});

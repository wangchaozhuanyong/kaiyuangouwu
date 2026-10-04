import { gql } from '@apollo/client';
import { describe, expect, it, vi } from 'vitest';
import { AdminQueryRuntime, getQueryRuntime, resourceIdentity } from './admin-query-runtime';

const policy = { staleTime: 30_000, pollInterval: 0, stage: 0 };
const owner = (fetch: () => Promise<unknown>, active = true) => ({
    page: '/catalog/list',
    active,
    loading: false,
    hasData: true,
    fetch,
});

describe('shared admin query runtime', () => {
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
        await Promise.resolve();
        expect(fetch).toHaveBeenCalledTimes(1);
        finish({ data: 'latest' });
        expect(await second).toEqual({ data: 'latest' });
        expect(await first).toEqual({ data: 'latest' });
        expect(runtime.state('/catalog/list').refreshing).toBe(false);
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

// @vitest-environment jsdom
import { ApolloClient, ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET_ASSET_CATEGORY_INDEX } from '../graphql/catalog.graphql';
import { TabPageContext } from '../layouts/tab-page-context';
import { createAdminCache } from '../runtime/admin-cache';
import { getQueryRuntime } from '../runtime/admin-query-runtime';
import type { AssetCategory } from '../utils/asset-categories';
import { useAssetCategoryIndex } from './use-asset-category-index';

const scope = vi.hoisted(() => ({ value: 'synthetic-store-a:zh_Hans' }));
vi.mock('../apollo', () => ({ getAdminQueryScope: () => scope.value }));

interface Asset {
    __typename: 'Asset';
    id: string;
    name: string;
    tags: Array<{ __typename: 'Tag'; id: string; value: string }>;
}
interface ReadRequest {
    skip: number;
    take: number;
    scope: string;
    signal?: AbortSignal;
    respond: (items: Asset[], totalItems: number) => void;
    fail: (message?: string) => void;
    deny: () => void;
}
interface ProbeProps {
    enabled: boolean;
    category: AssetCategory;
    active: boolean;
}
type IndexResult = ReturnType<typeof useAssetCategoryIndex>;
const page = '/catalog/products/synthetic-asset-picker';
const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    scope.value = 'synthetic-store-a:zh_Hans';
    vi.useRealTimers();
});

function asset(id: string, category: 'PRODUCT' | 'QUICK_LINK' | 'OTHER' = 'PRODUCT'): Asset {
    const label = { PRODUCT: '商品图', QUICK_LINK: '金刚区', OTHER: '其他' }[category];
    return {
        __typename: 'Asset',
        id,
        name: `synthetic-${id}.webp`,
        tags: [{ __typename: 'Tag', id: `tag-${category}`, value: `素材分类:${label}` }],
    };
}

async function setup(initial: Partial<ProbeProps> = {}, remountOnScope = false) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const requests: ReadRequest[] = [];
    const client = new ApolloClient({
        cache: createAdminCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests.push({
                        skip: operation.variables.options.skip,
                        take: operation.variables.options.take,
                        scope: scope.value,
                        signal: operation.getContext().fetchOptions?.signal,
                        respond: (items, totalItems) => {
                            observer.next({
                                data: { assets: { __typename: 'AssetList', items, totalItems } },
                            });
                            observer.complete();
                        },
                        fail: (message = 'synthetic metadata read failed') =>
                            observer.error(new Error(message)),
                        deny: () => {
                            observer.next({
                                errors: [
                                    {
                                        message: 'synthetic permission denied',
                                        extensions: { code: 'FORBIDDEN' },
                                    },
                                ],
                            });
                            observer.complete();
                        },
                    });
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let current!: IndexResult;
    let props: ProbeProps = { enabled: true, category: 'PRODUCT', active: true, ...initial };
    function Probe({ enabled, category }: ProbeProps) {
        const result = useAssetCategoryIndex(enabled, category);
        useLayoutEffect(() => {
            current = result;
        }, [result]);
        return (
            <output>
                {result.error ? 'error' : result.ready ? `ready:${result.ids.join(',')}` : 'loading'}
            </output>
        );
    }
    const render = async (next: Partial<ProbeProps> = {}) => {
        props = { ...props, ...next };
        await act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <TabPageContext.Provider
                        key={remountOnScope ? scope.value : undefined}
                        value={{ path: page, basename: '/', active: props.active }}
                    >
                        <Probe {...props} />
                    </TabPageContext.Provider>
                </ApolloProvider>,
            ),
        );
    };
    const respond = async (index: number, items: Asset[], totalItems = items.length) => {
        await act(async () => {
            requests[index].respond(items, totalItems);
            // Apollo defers an observable's cache notification after a refetch/fetchMore cycle.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
    };
    const fail = async (index: number) => {
        await act(async () => requests[index].fail());
    };
    const visibility = async (state: 'visible' | 'hidden') => {
        await act(async () => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
            document.dispatchEvent(new Event('visibilitychange'));
        });
    };
    const startRefresh = async () => {
        let work!: Promise<unknown>;
        // Browser click handlers commit synchronous preparation state before queued refresh work.
        act(() => {
            work = getQueryRuntime(client).refreshPage(page);
        });
        const requestSkipsBeforeTick = requests.map(request => request.skip);
        await act(async () => {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
        return { work, requestSkipsBeforeTick };
    };
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });
    await render();
    return {
        client,
        container,
        requests,
        render,
        respond,
        fail,
        visibility,
        startRefresh,
        result: () => current,
    };
}

describe('asset category index with real Apollo lifecycle', () => {
    it('reads all 377 metadata rows before publishing IDs beyond the first 100', async () => {
        const fixture = await setup({ category: 'QUICK_LINK' });
        const rows = Array.from({ length: 377 }, (_, index) =>
            asset(String(index + 1), index % 3 === 0 ? 'QUICK_LINK' : 'PRODUCT'),
        );
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.result().ready).toBe(false);
        for (let skip = 0; skip < rows.length; skip += 100) {
            expect(fixture.requests.at(-1)).toMatchObject({ skip, take: 100 });
            await fixture.respond(fixture.requests.length - 1, rows.slice(skip, skip + 100), rows.length);
            if (skip < 300) {
                expect(fixture.result().ready).toBe(false);
                expect(fixture.result().ids).toEqual([]);
            }
        }
        expect(fixture.requests.map(request => request.skip)).toEqual([0, 100, 200, 300]);
        expect(fixture.result()).toMatchObject({ ready: true, loading: false, error: undefined });
        expect(fixture.result().ids).toEqual(rows.filter((_, index) => index % 3 === 0).map(row => row.id));
        expect(fixture.result().ids).toContain('376');
    });

    it('represents pagination failure as an error and restarts only through explicit retry', async () => {
        const fixture = await setup();
        const rows = Array.from({ length: 120 }, (_, index) => asset(String(index + 1)));
        await fixture.respond(0, rows.slice(0, 100), rows.length);
        await fixture.fail(1);
        expect(fixture.result()).toMatchObject({ ready: false, loading: false, ids: [] });
        expect(fixture.result().error).toBeDefined();
        expect(fixture.container.textContent).toBe('error');
        await fixture.render();
        expect(fixture.requests).toHaveLength(2);
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = fixture.result().retry();
        });
        expect(fixture.requests.at(-1)?.skip).toBe(0);
        await fixture.respond(2, rows.slice(0, 100), rows.length);
        await retry;
        expect(fixture.requests.map(request => request.skip)).toEqual([0, 100, 0, 100]);
        await fixture.respond(3, rows.slice(100), rows.length);
        expect(fixture.requests.map(request => request.skip)).toEqual([0, 100, 0, 100]);
        expect(
            fixture.client.readQuery<{ assets: { items: Asset[] } }>({
                query: GET_ASSET_CATEGORY_INDEX,
                variables: {
                    options: { skip: 0, take: 100, sort: { id: 'ASC' }, filter: { type: { eq: 'IMAGE' } } },
                },
            })?.assets.items,
        ).toHaveLength(120);
        expect(fixture.result()).toMatchObject({ ready: true, loading: false, error: undefined });
        expect(fixture.result().ids).toHaveLength(120);
    });

    it('keeps an initial read failure distinct from an empty category and permits retry', async () => {
        const fixture = await setup({ category: 'OTHER' });
        await fixture.fail(0);
        expect(fixture.result().error).toBeDefined();
        expect(fixture.result().ready).toBe(false);
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = fixture.result().retry();
        });
        await fixture.respond(1, []);
        await retry;
        expect(fixture.result()).toMatchObject({ ids: [], ready: true, loading: false, error: undefined });
    });

    it.each(['closed', 'tab-hidden', 'window-hidden'] as const)(
        'stops pagination after the picker becomes %s',
        async mode => {
            const fixture = await setup();
            const rows = Array.from({ length: 250 }, (_, index) => asset(String(index + 1)));
            await fixture.respond(0, rows.slice(0, 100), rows.length);
            expect(fixture.requests).toHaveLength(2);
            if (mode === 'closed') await fixture.render({ enabled: false });
            else if (mode === 'tab-hidden') await fixture.render({ active: false });
            else await fixture.visibility('hidden');
            expect(fixture.requests[1].signal?.aborted).toBe(true);
            await fixture.respond(1, rows.slice(100, 200), rows.length);
            expect(fixture.requests).toHaveLength(2);
            expect(fixture.result().ready).toBe(false);
            expect(fixture.result().ids).toEqual([]);
        },
    );

    it('does not start index reads while disabled and pauses hidden initial continuation', async () => {
        const fixture = await setup({ enabled: false });
        expect(fixture.requests).toHaveLength(0);
        await fixture.render({ enabled: true });
        expect(fixture.requests).toHaveLength(1);
        await fixture.render({ active: false });
        await fixture.respond(0, [asset('1')], 101);
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.result().ready).toBe(false);
    });

    it('invalidates a complete disabled index and reads uploaded IDs when classification is enabled again', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('existing-product')]);
        expect(fixture.result()).toMatchObject({ ids: ['existing-product'], ready: true });
        await fixture.render({ enabled: false, category: 'ALL' });
        await act(async () => {
            await fixture.result().retry();
        });
        // Invalidating an ALL/closed picker must not start its disabled metadata read.
        expect(fixture.requests).toHaveLength(1);
        await fixture.render({ enabled: true, category: 'PRODUCT' });
        expect(fixture.requests).toHaveLength(2);
        expect(fixture.requests[1]).toMatchObject({ skip: 0, take: 100 });
        await fixture.respond(1, [asset('existing-product'), asset('new-upload')]);
        expect(fixture.result()).toMatchObject({
            ids: ['existing-product', 'new-upload'],
            ready: true,
            loading: false,
            error: undefined,
        });
    });

    it('retains committed IDs throughout same-scope page refresh and failure', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('old')]);
        const committed = fixture.result().ids;
        const { work: refresh } = await fixture.startRefresh();
        expect(fixture.requests).toHaveLength(2);
        expect(fixture.result()).toMatchObject({ ready: true, loading: true });
        expect(fixture.result().ids).toBe(committed);
        await fixture.fail(1);
        await refresh;
        expect(fixture.result()).toMatchObject({ ready: true, loading: false });
        expect(fixture.result().ids).toBe(committed);
        expect(fixture.result().error).toBeDefined();
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = fixture.result().retry();
        });
        expect(fixture.result().ids).toBe(committed);
        await fixture.respond(2, [asset('new')]);
        await retry;
        expect(fixture.result()).toMatchObject({
            ids: ['new'],
            ready: true,
            loading: false,
            error: undefined,
        });
    });

    it.each([false, true])(
        'recovers a failed metadata page through public page refresh with committed IDs %s',
        async hasCommitted => {
            const fixture = await setup();
            const rows = Array.from({ length: 120 }, (_, index) => asset(`refreshed-${index}`));
            let failedPageIndex = 1;
            let retained: string[] = [];
            if (hasCommitted) {
                await fixture.respond(0, [asset('retained')]);
                retained = fixture.result().ids;
                const { work: firstRefresh } = await fixture.startRefresh();
                await fixture.respond(1, rows.slice(0, 100), rows.length);
                await firstRefresh;
                failedPageIndex = 2;
            } else {
                await fixture.respond(0, rows.slice(0, 100), rows.length);
            }
            await fixture.fail(failedPageIndex);
            expect(fixture.result().error).toBeDefined();
            expect(fixture.result()).toMatchObject({ ids: retained, ready: hasCommitted, loading: false });
            const { work: recovery, requestSkipsBeforeTick } = await fixture.startRefresh();
            const firstPageIndex = failedPageIndex + 1;
            expect(requestSkipsBeforeTick.slice(firstPageIndex)).not.toContain(100);
            expect(fixture.requests[firstPageIndex]).toMatchObject({ skip: 0 });
            await fixture.respond(firstPageIndex, rows.slice(0, 100), rows.length);
            await recovery;
            expect(fixture.result().ids).toEqual(retained);
            expect(fixture.requests).toHaveLength(firstPageIndex + 2);
            expect(fixture.requests[firstPageIndex + 1]).toMatchObject({ skip: 100 });
            await fixture.respond(firstPageIndex + 1, rows.slice(100), rows.length);
            expect(fixture.result()).toMatchObject({
                ids: rows.map(row => row.id),
                ready: true,
                loading: false,
                error: undefined,
            });
        },
    );

    it('does not reuse another category filter while that category is still refreshing', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('product'), asset('quick', 'QUICK_LINK')]);
        const { work: refresh } = await fixture.startRefresh();
        await fixture.render({ category: 'QUICK_LINK' });
        expect(fixture.result()).toMatchObject({ ids: [], ready: false, loading: true });
        await fixture.respond(1, [asset('product'), asset('quick', 'QUICK_LINK')]);
        await refresh;
        expect(fixture.result()).toMatchObject({ ids: ['quick'], ready: true });
    });

    it('clears committed filters after a scope change', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('store-a')]);
        expect(fixture.result().ids).toEqual(['store-a']);
        scope.value = 'synthetic-store-b:zh_Hans';
        await fixture.render();
        expect(fixture.result()).toMatchObject({ ids: [], ready: false });
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = fixture.result().retry();
        });
        expect(fixture.requests.at(-1)?.scope).toBe(scope.value);
        await fixture.respond(fixture.requests.length - 1, [asset('store-b')]);
        await retry;
        expect(fixture.result()).toMatchObject({ ids: ['store-b'], ready: true });
    });

    it('ignores a late pagination result from the previous scope', async () => {
        const fixture = await setup({}, true);
        const oldRows = Array.from({ length: 200 }, (_, index) => asset(`store-a-${index}`));
        await fixture.respond(0, oldRows.slice(0, 100), oldRows.length);
        const oldPage = fixture.requests[1];
        scope.value = 'synthetic-store-b:zh_Hans';
        await act(async () => {
            await fixture.client.clearStore();
        });
        await fixture.render();
        expect(fixture.result()).toMatchObject({ ids: [], ready: false });
        await act(async () => oldPage.respond(oldRows.slice(100), oldRows.length));
        expect(fixture.result().ids).toEqual([]);
        expect(fixture.requests.at(-1)?.scope).toBe(scope.value);
        await fixture.respond(fixture.requests.length - 1, [asset('store-b')]);
        expect(fixture.result()).toMatchObject({ ids: ['store-b'], ready: true, error: undefined });
    });

    it('does not automatically repeat a failed new-scope read and recovers through explicit retry', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('store-a')]);
        scope.value = 'synthetic-store-b:zh_Hans';
        await fixture.render();
        expect(fixture.requests).toHaveLength(2);
        await fixture.fail(1);
        expect(fixture.result()).toMatchObject({ ids: [], ready: false, loading: false });
        expect(fixture.result().error).toBeDefined();
        await fixture.render();
        expect(fixture.requests).toHaveLength(2);
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = fixture.result().retry();
        });
        expect(fixture.requests).toHaveLength(3);
        await fixture.respond(2, [asset('store-b')]);
        await retry;
        expect(fixture.result()).toMatchObject({
            ids: ['store-b'],
            ready: true,
            loading: false,
            error: undefined,
        });
    });

    it('discards committed IDs when permission is lost during refresh', async () => {
        const fixture = await setup();
        await fixture.respond(0, [asset('private-product')]);
        const { work: refresh } = await fixture.startRefresh();
        await act(async () => fixture.requests[1].deny());
        await refresh;
        expect(fixture.result().error).toBeDefined();
        expect(fixture.result()).toMatchObject({ ids: [], ready: false, loading: false });
        expect(fixture.container.textContent).not.toContain('private-product');
    });

    it('reports a non-advancing metadata page instead of completing with partial IDs', async () => {
        const fixture = await setup();
        const first = Array.from({ length: 100 }, (_, index) => asset(String(index + 1)));
        await fixture.respond(0, first, 120);
        await fixture.respond(1, first, 120);
        expect(fixture.result()).toMatchObject({ ids: [], ready: false, loading: false });
        expect(fixture.result().error).toBeDefined();
        expect(fixture.requests).toHaveLength(2);
    });
});

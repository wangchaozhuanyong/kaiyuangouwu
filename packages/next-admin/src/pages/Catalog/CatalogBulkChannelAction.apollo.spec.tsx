// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLError } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CatalogBulkChannelAction } from './CatalogBulkChannelAction';

vi.mock('../../apollo', () => ({ getAdminQueryScope: () => 'store-a' }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('keeps search-independent selection and retries only the failed part of a mixed bulk write', async () => {
    const channels = [
        {
            __typename: 'AssignmentChannel',
            id: 'source',
            code: 'source',
            displayName: '原店',
            isDefault: false,
        },
        {
            __typename: 'AssignmentChannel',
            id: 'target',
            code: 'target',
            displayName: '目标店',
            isDefault: false,
        },
    ];
    const assigned = new Set<string>();
    const item = (id: string) => ({
        __typename: 'Product',
        id,
        name: `商品 ${id}`,
        enabled: true,
        channels: assigned.has(id) ? channels : channels.slice(0, 1),
    });
    const writes: string[][] = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'NextAdminCatalogReferences') {
                        observer.next({
                            data: Object.fromEntries(
                                Object.entries(operation.variables).map(([key, ids]) => [
                                    key.replace('ids', 'batch'),
                                    {
                                        __typename: 'CatalogProductChannelAssignmentList',
                                        items: (ids as string[]).map(item),
                                        totalItems: (ids as string[]).length,
                                    },
                                ]),
                            ),
                        });
                    } else if (operation.operationName === 'AssignCatalogProductsToChannel') {
                        const ids = operation.variables.input.productIds as string[];
                        writes.push(ids);
                        const accepted = writes.length === 1 ? ids.filter(id => id === 'a') : ids;
                        accepted.forEach(id => assigned.add(id));
                        observer.next({
                            data: { assignProductsToChannel: accepted.map(item) },
                            ...(writes.length === 1
                                ? {
                                      errors: [
                                          new GraphQLError('b failed', { path: ['assignProductsToChannel'] }),
                                      ],
                                  }
                                : {}),
                        });
                    } else {
                        const ids = operation.variables.options?.filter?.name?.contains ? ['c'] : ['a', 'b'];
                        observer.next({
                            data: {
                                catalogProductChannelAssignments: {
                                    __typename: 'CatalogProductChannelAssignmentList',
                                    items: ids.map(item),
                                    totalItems: ids.length,
                                    channels,
                                    scopeChannel: channels[0],
                                    summary: {
                                        __typename: 'CatalogProductChannelAssignmentSummary',
                                        totalItems: ids.length,
                                        unassignedItems: 0,
                                        multiChannelItems: 0,
                                        channelCounts: [],
                                    },
                                },
                            },
                        });
                    }
                    observer.complete();
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const button = (text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            control => control.textContent === text,
        )!;
    try {
        await act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <CatalogBulkChannelAction />
                </ApolloProvider>,
            ),
        );
        await act(async () => button('批量店铺').click());
        await act(() =>
            vi.waitFor(() => expect(document.querySelector('[aria-label="目标店铺"]')).not.toBeNull()),
        );
        await act(async () => {
            const target = document.querySelector<HTMLSelectElement>('[aria-label="目标店铺"]')!;
            target.value = 'target';
            target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () =>
            document.querySelector<HTMLInputElement>('[aria-label="选择商品：商品 a"]')!.click(),
        );
        await act(async () =>
            document.querySelector<HTMLInputElement>('[aria-label="选择商品：商品 b"]')!.click(),
        );
        await act(() =>
            vi.waitFor(() => expect(document.body.textContent).toContain('已选 2 个商品，有效 2 个')),
        );
        await act(async () => {
            const search = document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'other');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(() =>
            vi.waitFor(() =>
                expect(document.querySelector('[aria-label="选择商品：商品 c"]')).not.toBeNull(),
            ),
        );
        expect(document.body.textContent).toContain('已选 2 个商品，有效 2 个');
        await act(async () => button('确认分配').click());
        await act(() =>
            vi.waitFor(() => expect(document.body.textContent).toContain('已选 1 个商品，有效 1 个')),
        );
        expect(writes).toEqual([['a', 'b']]);
        expect(document.body.textContent).toContain('部分商品未确认成功');
        await act(async () => button('确认分配').click());
        await act(() => vi.waitFor(() => expect(document.body.textContent).toContain('已选 0 个商品')));
        expect(writes).toEqual([['a', 'b'], ['b']]);
    } finally {
        await act(async () => root.unmount());
        client.stop();
        host.remove();
    }
});

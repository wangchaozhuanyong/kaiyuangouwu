// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLError } from 'graphql';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabPageContext } from '../layouts/tab-page-context';
import { useCatalogReferences } from './use-catalog-references';

const scope = vi.hoisted(() => ({ value: 'store-a' }));
vi.mock('../apollo', () => ({ getAdminQueryScope: () => scope.value }));
const cleanup: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanup.splice(0).forEach(close => close()));
    vi.useRealTimers();
    scope.value = 'store-a';
});

async function setup(ids: string[]) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const requests: Array<{ variables: Record<string, string[]>; observer: any }> = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests.push({ variables: operation.variables, observer });
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let current!: ReturnType<typeof useCatalogReferences>;
    function Consumer() {
        const query = useCatalogReferences(ids);
        useEffect(() => {
            current = query;
        }, [query]);
        const [draft, setDraft] = useState('unsaved');
        return (
            <>
                <input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} />
                <output>
                    {query.references
                        .map(
                            reference => `${reference.id}:${reference.state}:${reference.entity?.name ?? ''}`,
                        )
                        .join('|')}
                </output>
            </>
        );
    }
    const render = (active = true) =>
        act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <TabPageContext.Provider
                        key={scope.value}
                        value={{ path: '/storefront', basename: '/', active }}
                    >
                        <Consumer />
                        <Consumer />
                    </TabPageContext.Provider>
                </ApolloProvider>,
            ),
        );
    cleanup.push(() => {
        root.unmount();
        client.stop();
        host.remove();
    });
    await render();
    const resolve = (index: number, available: string[]) =>
        act(async () => {
            const request = requests[index];
            request.observer.next({
                data: Object.fromEntries(
                    Object.entries(request.variables).map(([key, batch]) => {
                        const items = batch
                            .filter(id => available.includes(id))
                            .reverse()
                            .map(id => ({
                                __typename: 'Product',
                                id,
                                name: `latest ${id}`,
                                slug: id,
                                enabled: true,
                            }));
                        return [
                            key.replace('ids', 'batch'),
                            { __typename: 'ProductList', items, totalItems: items.length },
                        ];
                    }),
                ),
            });
            request.observer.complete();
        });
    return { requests, host, render, resolve, client, current: () => current };
}

describe('actual Apollo association reconciliation', () => {
    it('independently resolves 205 identities when a GraphQL sibling batch fails', async () => {
        const ids = Array.from({ length: 205 }, (_, index) => String(index));
        const fixture = await setup(ids);
        expect(Object.values(fixture.requests[0].variables).map(batch => batch.length)).toEqual([
            100, 100, 5,
        ]);
        await act(async () => {
            fixture.requests[0].observer.next({
                data: Object.fromEntries(
                    Object.entries(fixture.requests[0].variables).map(([key, batch]) => {
                        const items = batch.map(id => ({
                            __typename: 'Product',
                            id,
                            name: id,
                            slug: id,
                            enabled: true,
                        }));
                        return [
                            key.replace('ids', 'batch'),
                            key === 'ids1'
                                ? null
                                : { __typename: 'ProductList', items, totalItems: items.length },
                        ];
                    }),
                ),
                errors: [new GraphQLError('Read failed', { path: ['batch1'] })],
            });
            fixture.requests[0].observer.complete();
        });
        expect(fixture.current().available).toHaveLength(105);
        expect(fixture.current().unknown.map(reference => reference.id)).toEqual(ids.slice(100, 200));
        expect(fixture.current().unavailable).toEqual([]);
        expect(fixture.current().references.map(reference => reference.id)).toEqual(ids);
    });
    it('shares a complete ID read, reports six valid and two unavailable, restores eight in order, and preserves draft', async () => {
        const ids = Array.from({ length: 8 }, (_, index) => String(index));
        const fixture = await setup(ids);
        expect(fixture.requests).toHaveLength(1);
        await fixture.resolve(
            0,
            ids.filter(id => !['1', '5'].includes(id)),
        );
        expect(fixture.current().available).toHaveLength(6);
        expect(fixture.current().unavailable.map(reference => reference.id)).toEqual(['1', '5']);
        let first!: Promise<any>, second!: Promise<any>;
        await act(async () => {
            first = fixture.current().refetch();
            second = fixture.current().refetch();
        });
        expect(first).toBe(second);
        expect(fixture.requests).toHaveLength(2);
        await fixture.resolve(1, ids);
        await first;
        expect(fixture.current().available.map(reference => reference.id)).toEqual(ids);
        expect(fixture.host.querySelector<HTMLInputElement>('input')?.value).toBe('unsaved');
        const retry = fixture
            .current()
            .refetch()
            .catch(error => error);
        await act(async () => {
            await Promise.resolve();
            fixture.requests.at(-1)!.observer.error(new Error('network unavailable'));
        });
        await act(async () => {
            await retry;
        });
        await act(() => vi.waitFor(() => expect(fixture.current().unknown).toHaveLength(8)));
        expect(fixture.current().unavailable).toHaveLength(0);
        expect(fixture.current().unknown.map(reference => reference.id)).toEqual(ids);
        expect(fixture.host.querySelector<HTMLInputElement>('input')?.value).toBe('unsaved');
    });
    it('pauses the 30 second check in hidden pages and offline, then resumes on activity', async () => {
        const fixture = await setup(['sku-1']);
        await fixture.resolve(0, ['sku-1']);
        vi.useFakeTimers();
        await fixture.render(false);
        await act(async () => vi.advanceTimersByTimeAsync(60_001));
        expect(fixture.requests).toHaveLength(1);
        await fixture.render();
        await act(async () => vi.advanceTimersByTimeAsync(30_001));
        expect(fixture.requests.length).toBeGreaterThan(1);
        await fixture.resolve(fixture.requests.length - 1, ['sku-1']);
        const before = fixture.requests.length;
        await act(async () => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
            window.dispatchEvent(new Event('offline'));
        });
        await act(async () => vi.advanceTimersByTimeAsync(60_001));
        expect(fixture.requests).toHaveLength(before);
        await act(async () => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
            window.dispatchEvent(new Event('online'));
        });
        await act(async () => vi.advanceTimersByTimeAsync(30_001));
        expect(fixture.requests.length).toBeGreaterThan(before);
    });
    it('drops the former store results when session scope switches', async () => {
        const fixture = await setup(['1']);
        await fixture.resolve(0, ['1']);
        await act(async () => fixture.client.clearStore());
        scope.value = 'store-b';
        await fixture.render();
        expect(fixture.current().available).toHaveLength(0);
        expect(fixture.current().unknown.map(reference => reference.id)).toEqual(['1']);
        await fixture.resolve(fixture.requests.length - 1, []);
        expect(fixture.current().unavailable.map(reference => reference.id)).toEqual(['1']);
    });
});

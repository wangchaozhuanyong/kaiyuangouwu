// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabPageContext } from '../layouts/tab-page-context';
import { getQueryRuntime } from '../runtime/admin-query-runtime';
import { useAdminQuery } from './use-admin-query';

const scope = vi.hoisted(() => ({ value: 'store-a:zh' }));
vi.mock('../apollo', () => ({ getAdminQueryScope: () => scope.value }));
const query = gql`
    query RuntimeProduct($id: ID!) {
        product(id: $id) {
            id
            name
        }
    }
`;
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.useRealTimers();
    scope.value = 'store-a:zh';
});
async function setup() {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const requests: Array<{ id: string; observer: any }> = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests.push({ id: operation.variables.id, observer });
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let result: any;
    function Probe({ id }: { id: string }) {
        const current = useAdminQuery<{ product: { id: string; name: string } }>(query, {
            variables: { id },
            pollInterval: 0,
        });
        useLayoutEffect(() => {
            result = current;
        }, [current]);
        return <p>{current.data?.product?.name ?? (current.error ? 'error' : 'loading')}</p>;
    }
    const render = async (id = '1', active = true) =>
        act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <TabPageContext.Provider
                        key={scope.value}
                        value={{ path: '/catalog/products/1', basename: '/', active }}
                    >
                        <Probe id={id} />
                    </TabPageContext.Provider>
                </ApolloProvider>,
            ),
        );
    const resolve = async (index: number, name: string) =>
        act(async () => {
            const request = requests[index];
            request.observer.next({ data: { product: { __typename: 'Product', id: request.id, name } } });
            request.observer.complete();
        });
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });
    await render();
    return { client, requests, render, resolve, container, result: () => result };
}

describe('real Apollo admin query lifecycle', () => {
    it('keeps a fresh resource across hidden tabs without another request', async () => {
        const fixture = await setup();
        expect(fixture.requests).toHaveLength(1);
        await fixture.resolve(0, 'first');
        await fixture.render('1', false);
        expect(fixture.container.textContent).toBe('first');
        await fixture.render();
        expect(fixture.container.textContent).toBe('first');
        expect(fixture.requests).toHaveLength(1);
    });
    it('retains the same result during refresh/failure and returns a rejected receipt to await callers', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 'first');
        let first!: Promise<any>, second!: Promise<any>;
        await act(async () => {
            first = fixture.result().refetch();
            second = fixture.result().refetch();
        });
        expect(first).toBe(second);
        expect(fixture.requests).toHaveLength(2);
        expect(fixture.result().loading).toBe(true);
        expect(fixture.container.textContent).toBe('first');
        const handled = first.catch(error => error);
        await act(async () => fixture.requests[1].observer.error(new Error('network offline')));
        expect(await handled).toBeInstanceOf(Error);
        expect(fixture.container.textContent).toBe('first');
        expect(getQueryRuntime(fixture.client).state('/catalog/products/1').failed).toBe(1);
    });
    it('does not show the previous entity under new query variables', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 'first');
        await fixture.render('2');
        expect(fixture.container.textContent).toBe('loading');
        expect(fixture.requests.at(-1)?.id).toBe('2');
        await fixture.resolve(1, 'second');
        expect(fixture.container.textContent).toBe('second');
    });
    it('does not retain old store data when the Apollo cache and request scope switch', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 'store A product');
        await act(async () => {
            await fixture.client.clearStore();
        });
        scope.value = 'store-b:zh';
        await fixture.render();
        expect(fixture.container.textContent).not.toContain('store A product');
        const refresh = fixture.result().refetch();
        await act(async () => {
            await Promise.resolve();
        });
        await fixture.resolve(fixture.requests.length - 1, 'store B product');
        await refresh;
        expect(fixture.container.textContent).toBe('store B product');
    });
    it('joins manual refresh to an already running initial read', async () => {
        const fixture = await setup();
        const refresh = getQueryRuntime(fixture.client).refreshPage('/catalog/products/1');
        await act(async () => {
            await Promise.resolve();
        });
        expect(fixture.requests).toHaveLength(1);
        await fixture.resolve(0, 'first');
        await refresh;
        expect(fixture.requests).toHaveLength(1);
    });
    it('pauses imperative polling while hidden or offline and resumes only when active', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 'first');
        vi.useFakeTimers();
        await act(async () => fixture.result().startPolling(100));
        await fixture.render('1', false);
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(fixture.requests).toHaveLength(1);
        await fixture.render();
        await act(async () => vi.advanceTimersByTimeAsync(101));
        expect(fixture.requests).toHaveLength(2);
        await fixture.resolve(1, 'second');
        await act(async () => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
            window.dispatchEvent(new Event('offline'));
        });
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(fixture.requests).toHaveLength(2);
        await act(async () => fixture.result().stopPolling());
    });
});

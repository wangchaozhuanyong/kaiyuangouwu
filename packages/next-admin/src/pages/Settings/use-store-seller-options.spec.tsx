// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { useStoreSellerOptions } from './use-store-seller-options';

vi.mock('../../apollo', () => ({ getAdminQueryScope: () => 'seller-directory-test' }));
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function setup(enabled = true, canRead = true) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const requests: Array<{ skip: number; fields: string[]; observer: any }> = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const definition = operation.query.definitions.find(
                        item => item.kind === 'OperationDefinition',
                    );
                    requests.push({
                        skip: operation.variables.sellerOptions.skip,
                        fields:
                            definition?.kind === 'OperationDefinition'
                                ? definition.selectionSet.selections.flatMap(item =>
                                      item.kind === 'Field' ? [item.name.value] : [],
                                  )
                                : [],
                        observer,
                    });
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let result: ReturnType<typeof useStoreSellerOptions>;
    function Probe({ enabled }: { enabled: boolean }) {
        const options = useStoreSellerOptions(enabled);
        useEffect(() => {
            result = options;
        }, [options]);
        return (
            <p>
                {options.status}:{options.sellers.length}
            </p>
        );
    }
    const render = async (open = true, permission = true) =>
        act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <AdminPermissionsContext.Provider
                        value={{
                            permissions: permission ? ['ReadSeller'] : [],
                            hasAnyPermission: () => permission,
                        }}
                    >
                        <Probe enabled={open} />
                    </AdminPermissionsContext.Provider>
                </ApolloProvider>,
            ),
        );
    const resolve = async (index: number, count: number, totalItems: number) =>
        act(async () => {
            const request = requests[index];
            request.observer.next({
                data: {
                    sellers: {
                        __typename: 'SellerList',
                        totalItems,
                        items: Array.from({ length: count }, (_, i) => ({
                            __typename: 'Seller',
                            id: String(request.skip + i + 1),
                            name: `Seller ${request.skip + i + 1}`,
                            createdAt: '2026-01-01T00:00:00Z',
                            updatedAt: '2026-01-01T00:00:00Z',
                        })),
                    },
                },
            });
            request.observer.complete();
        });
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });
    await render(enabled, canRead);
    return { requests, render, resolve, result: () => result };
}

describe('editor seller directory using the managed Apollo query', () => {
    it('reads sellers independently only after opening an authorized editor', async () => {
        const fixture = await setup(false);
        expect(fixture.requests).toHaveLength(0);
        await fixture.render(true, false);
        expect(fixture.requests).toHaveLength(0);
        expect(fixture.result().status).toBe('forbidden');
        await fixture.render();
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.requests[0].fields).toEqual(['sellers']);
        expect(fixture.result().status).toBe('loading');
        await fixture.resolve(0, 2, 2);
        expect(fixture.result().status).toBe('ready');
        expect(fixture.result().sellers).toHaveLength(2);
    });

    it('keeps rebinding unavailable until every page has arrived', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 201);
        expect(fixture.requests[1].skip).toBe(100);
        expect(fixture.result().status).toBe('loading');
        await fixture.resolve(1, 100, 201);
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(fixture.requests[2]?.skip).toBe(200);
        });
        expect(fixture.result().status).toBe('loading');
        await fixture.resolve(2, 1, 201);
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(fixture.result().status).toBe('ready');
        });
        expect(fixture.result().sellers).toHaveLength(201);
    });

    it('treats an empty successful list as ready instead of loading forever', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 0, 0);
        expect(fixture.result().status).toBe('ready');
        expect(fixture.result().sellers).toEqual([]);
    });

    it('allows a local read retry after an initial error', async () => {
        const fixture = await setup();
        await act(async () => fixture.requests[0].observer.error(new Error('Network error')));
        expect(fixture.result().status).toBe('error');
        expect(fixture.requests).toHaveLength(1);
        await act(async () => fixture.result().retry());
        expect(fixture.requests).toHaveLength(2);
        await fixture.resolve(1, 1, 1);
        expect(fixture.result().status).toBe('ready');
    });

    it('stops failed pagination and resumes it only after retry', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 101);
        await act(async () => fixture.requests[1].observer.error(new Error('Network error')));
        expect(fixture.result().status).toBe('error');
        expect(fixture.requests).toHaveLength(2);
        await act(async () => fixture.result().retry());
        await fixture.resolve(2, 100, 101);
        await fixture.resolve(3, 1, 101);
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(fixture.result().status).toBe('ready');
        });
        expect(fixture.result().sellers).toHaveLength(101);
    });

    it('discards options after a permission denial even if an earlier page was cached', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 101);
        await act(async () => fixture.requests[1].observer.error(new Error('Forbidden')));
        expect(fixture.result().status).toBe('forbidden');
        expect(fixture.result().sellers).toEqual([]);
    });

    it('stops when pagination makes no progress rather than requesting forever', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 101);
        await fixture.resolve(1, 0, 101);
        expect(fixture.result().status).toBe('error');
        expect(fixture.requests).toHaveLength(2);
    });

    it('ignores a late pagination failure after the editor closes', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 101);
        await fixture.render(false);
        await act(async () => fixture.requests[1].observer.error(new Error('Network error')));
        expect(fixture.result().status).toBe('loading');
        expect(fixture.result().error).toBe('');
        expect(fixture.requests).toHaveLength(2);
    });

    it('does not retain a late pagination error when ReadSeller is revoked', async () => {
        const fixture = await setup();
        await fixture.resolve(0, 100, 101);
        await fixture.render(true, false);
        await act(async () => fixture.requests[1].observer.error(new Error('Network error')));
        expect(fixture.result().status).toBe('forbidden');
        expect(fixture.result().sellers).toEqual([]);
        expect(fixture.result().error).toBe('');
        expect(fixture.requests).toHaveLength(2);
    });
});

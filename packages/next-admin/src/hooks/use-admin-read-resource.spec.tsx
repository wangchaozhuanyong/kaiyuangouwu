// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { useAdminReadResource } from './use-admin-read-resource';

vi.mock('../apollo', () => ({ getAdminQueryScope: () => 'store-a' }));

describe('HTTP resource page lifecycle', () => {
    it('ignores a late cancelled read and fetches again when its standalone workspace resumes', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });
        const requests: Array<{ signal: AbortSignal; resolve: (value: string) => void }> = [];
        const read = (signal: AbortSignal) =>
            new Promise<string>(resolve => requests.push({ signal, resolve }));
        function Probe() {
            const result = useAdminReadResource('panel', read);
            return <p>{result.data ?? 'empty'}</p>;
        }
        const container = document.createElement('div');
        const root = createRoot(container);
        const render = (active: boolean) =>
            act(async () =>
                root.render(
                    <ApolloProvider client={client}>
                        <PageRuntimeContext.Provider value={{ page: '/panel', active }}>
                            <Probe />
                        </PageRuntimeContext.Provider>
                    </ApolloProvider>,
                ),
            );
        try {
            await render(false);
            expect(requests).toHaveLength(0);
            await render(true);
            expect(requests).toHaveLength(1);
            await render(false);
            expect(requests[0].signal.aborted).toBe(true);
            await act(async () => requests[0].resolve('late cancelled data'));
            expect(container.textContent).toBe('empty');
            await render(true);
            expect(requests).toHaveLength(2);
            await act(async () => requests[1].resolve('fresh data'));
            expect(container.textContent).toBe('fresh data');
        } finally {
            await act(async () => root.unmount());
            client.stop();
            vi.restoreAllMocks();
        }
    });
});

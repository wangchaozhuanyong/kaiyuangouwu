import { QueryClient, QueryObserver } from '@tanstack/react-query';

import {
    consumeStorefrontRealtimeStream,
    invalidateStorefrontRealtimeQueries,
} from '../../src/realtime-updates';
import { fetchPublicPage } from '../../src/storefront-page-data';

const qa = {
    async run(cancel = false) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const controller = new AbortController();
        const scope = { marketCode: 'synthetic-a:MYR', languageCode: 'en' };
        const key = ['storefront', scope.marketCode, scope.languageCode, 'config'];
        const observer = new QueryObserver(client, {
            queryKey: key,
            initialData: '0',
            staleTime: Infinity,
            queryFn: async ({ signal }) => {
                const page = await fetchPublicPage('en', 'MYR', signal, { kind: 'home' }, 'synthetic-a');
                if (!page) throw new Error('Missing synthetic public page');
                return page.version;
            },
        });
        const visible: string[] = [];
        const stop = observer.subscribe(result => {
            if (result.isSuccess) visible.push(result.data);
        });
        let completion = Promise.resolve();
        let events = 0;
        try {
            await observer.refetch();
            const response = await fetch('/__burst/events', { signal: controller.signal });
            if (!response.body) throw new Error('Missing SSE body');
            await consumeStorefrontRealtimeStream(
                response.body,
                event => {
                    events++;
                    completion = invalidateStorefrontRealtimeQueries(client, event, scope, controller.signal);
                    if (cancel && events === 1) controller.abort();
                },
                { signal: controller.signal },
            ).catch(error => {
                if (!controller.signal.aborted) throw error;
            });
            await completion;
            const final = client.getQueryData(key);
            const result = document.querySelector('#result');
            if (!result) throw new Error('Missing local result element');
            result.textContent = String(final);
            return { events, final, visible };
        } finally {
            controller.abort();
            stop();
            client.clear();
        }
    },
};
(window as unknown as { burstQA: typeof qa }).burstQA = qa;

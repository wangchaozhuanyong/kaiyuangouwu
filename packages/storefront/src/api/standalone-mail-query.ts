import type { IcloudQueryResult, MailQueryApi } from './mail-query';

import { createRequestSignal, SHOP_API_QUERY_TIMEOUT_MS } from './helpers';
import { watchMailEvents } from './mail-events';

/** Same page and services, with only anonymous same-origin mail endpoints exposed. */
export const standaloneMailQueryApi: Pick<MailQueryApi, 'queryMails' | 'watchMailEvents'> = {
    async queryMails(queryCode, signal) {
        const request = createRequestSignal(signal, SHOP_API_QUERY_TIMEOUT_MS);
        try {
            const response = await fetch('/api/mail/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryCode }),
                signal: request.signal,
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
                referrerPolicy: 'no-referrer',
            });
            if (!response.ok) throw new Error('Mail query unavailable');
            return (await response.json()) as IcloudQueryResult;
        } finally {
            request.cleanup();
        }
    },
    watchMailEvents: (code, callbacks, signal) =>
        watchMailEvents(code, {}, callbacks, signal, {
            url: new URL('/api/mail/events', window.location.origin).href,
            credentials: 'omit',
        }),
};

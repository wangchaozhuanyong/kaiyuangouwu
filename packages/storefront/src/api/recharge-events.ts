import { rechargeTaskFinished, type RechargeTask } from '../client-plugins/gpt-recharge/contracts';
import { consumeRealtimeFrames, parseStorefrontRealtimeFrameFields } from '../realtime-updates';

import { abortableDelay, createRequestSignal, shopApiHeaders, storefrontRealtimeUrl } from './helpers';
import { sessionTransport } from './session-transport';

export async function watchRechargeEvents(
    id: string,
    credential: string,
    market: string,
    token: () => string | null,
    signal: AbortSignal,
    onTask: (task: RechargeTask) => void,
    onConnection: (state: 'connecting' | 'live' | 'error' | 'denied') => void,
): Promise<void> {
    const url = new URL(storefrontRealtimeUrl());
    url.pathname = url.pathname.replace(/\/events$/u, '/recharge-events');
    url.search = '';
    const retries = [2000, 5000, 15000, 30000];
    let failures = 0;
    let finished = false;
    onConnection('connecting');
    while (!signal.aborted && !finished) {
        let retryAfter = 0;
        let connectedAt: number | undefined;
        try {
            const request = createRequestSignal(signal, 10000);
            let response: Response;
            try {
                response = await sessionTransport(url.toString(), false, request.signal, () =>
                    fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        cache: 'no-store',
                        signal: request.signal,
                        headers: {
                            ...shopApiHeaders(undefined, market, token()),
                            accept: 'text/event-stream',
                            'content-type': 'application/json',
                        },
                        body: JSON.stringify({ id, credential }),
                    }),
                );
            } finally {
                request.cleanup();
            }
            if (
                !response.ok ||
                !response.body ||
                !response.headers.get('content-type')?.startsWith('text/event-stream')
            ) {
                await response.body?.cancel();
                if ([400, 401, 403].includes(response.status)) {
                    onConnection('denied');
                    return;
                }
                retryAfter = Math.min(
                    300000,
                    Math.max(0, Number(response.headers.get('retry-after')) * 1000 || 0),
                );
                throw new Error('Progress stream unavailable');
            }
            connectedAt = Date.now();
            await consumeRealtimeFrames(
                response.body,
                frame => {
                    const fields = parseStorefrontRealtimeFrameFields(frame);
                    if (fields.eventName === 'ready') return { heartbeatIntervalMs: 15000 };
                    if (fields.eventName !== 'task') return {};
                    const task = JSON.parse(fields.data.join('\n')) as RechargeTask;
                    if (
                        task.id !== id ||
                        task.credential !== credential ||
                        !Number.isFinite(Date.parse(task.updatedAt))
                    )
                        throw new Error('Unexpected progress task');
                    if (!signal.aborted) onTask(task);
                    finished = rechargeTaskFinished(task.status);
                    return { activity: true };
                },
                {
                    signal,
                    onReady: () => {
                        onConnection('live');
                    },
                },
            );
            if (!finished && !signal.aborted) throw new Error('Progress stream closed');
        } catch {
            if (signal.aborted || finished) return;
            if (connectedAt !== undefined && Date.now() - connectedAt >= 30000) failures = 0;
            onConnection('error');
            await abortableDelay(
                Math.max(retryAfter, retries[Math.min(failures++, retries.length - 1)]),
                signal,
            );
        }
    }
}

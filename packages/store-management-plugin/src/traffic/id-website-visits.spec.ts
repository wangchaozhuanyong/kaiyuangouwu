import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

import { forwardIdWebsiteVisit } from './id-website-visits';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

it('sends only a stable site-scoped token with a verifiable, retry-safe signature', async () => {
    const key = Buffer.alloc(32, 7);
    const ip = '203.0.113.7';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T23:59:00Z'));
    vi.stubEnv(
        'ID_WEBSITE_VISIT_INGEST_URL',
        'https://id.example/api/id-business-v2/workspace-website-monitor/visits/ingest',
    );
    vi.stubEnv('ID_WEBSITE_VISIT_SIGNING_KEY', key.toString('hex'));
    const send = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', send);

    await forwardIdWebsiteVisit('damatong.net', ip, randomUUID());
    vi.setSystemTime(new Date('2026-11-26T00:01:00Z'));
    await forwardIdWebsiteVisit('damatong.net', ip, randomUUID());
    await forwardIdWebsiteVisit('moyaoai.com', ip, randomUUID());
    await forwardIdWebsiteVisit('other.example', ip, randomUUID());
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[0][1]).toMatchObject({
        body: send.mock.calls[1][1]?.body,
        headers: send.mock.calls[1][1]?.headers,
    });
    const payloads = send.mock.calls.map(([, request]) => {
        expect(typeof request?.body).toBe('string');
        const serialized = request?.body as string;
        expect(serialized).not.toContain(ip);
        const { eventId, host, ipToken, occurredAt } = JSON.parse(serialized);
        expect(Object.keys(JSON.parse(serialized))).toEqual(['eventId', 'host', 'ipToken', 'occurredAt']);
        expect(new Headers(request?.headers).get('x-website-visit-signature')).toBe(
            createHmac('sha256', key)
                .update(JSON.stringify([eventId, host, ipToken, occurredAt]))
                .digest('hex'),
        );
        return ipToken;
    });
    expect(payloads[2]).toBe(payloads[0]);
    expect(payloads[3]).not.toBe(payloads[0]);
});

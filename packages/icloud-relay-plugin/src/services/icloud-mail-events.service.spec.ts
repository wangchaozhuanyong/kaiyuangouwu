import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcloudMailOutbox } from '../entities/icloud-mail-outbox.entity';

import { IcloudMailEventsService, mailEventPayload } from './icloud-mail-events.service';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function fixture() {
    const row = new IcloudMailOutbox({
        id: 1,
        eventId: '11111111-1111-4111-8111-111111111111',
        primaryAccountId: '1',
        virtualEmailId: '2',
        createdAt: new Date('2026-10-04T08:21:00Z'),
        deliveredAt: null,
    });
    let delivered = false;
    const repo = {
        find: vi.fn(() => Promise.resolve(delivered ? [] : [row])),
        update: vi.fn(() => {
            delivered = true;
            return Promise.resolve();
        }),
        save: vi.fn(value => Promise.resolve(value)),
    };
    const options = {
        mailWebhookUrl: 'https://id.example.test/api/id-business-v2/vendure-mailboxes/events',
        mailWebhookSecret: 'synthetic-signing-secret-for-local-tests',
    };
    const service = new IcloudMailEventsService(
        { getRepository: () => repo } as never,
        { isServer: true } as never,
        options,
    );
    return { service, repo, row, options };
}
describe('durable mailbox notification outbox', () => {
    it('sends signed metadata and does no database polling when the queue is empty', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true, data: { accepted: true } }),
        });
        vi.stubGlobal('fetch', fetch);
        const f = fixture();
        f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        const request = fetch.mock.calls[0][1];
        expect(JSON.parse(request.body)).toEqual(mailEventPayload(f.row));
        expect(request.headers['x-mail-signature']).toBe(
            createHmac('sha256', f.options.mailWebhookSecret)
                .update(`${request.headers['x-mail-timestamp']}.${request.body}`)
                .digest('hex'),
        );
        expect(request.body).not.toMatch(/code|subject|bodyText|email@/);
        const count = f.repo.find.mock.calls.length;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.repo.find).toHaveBeenCalledTimes(count);
        f.service.onModuleDestroy();
    });
    it('retains the row on delivery failure, retries with backoff and checkpoints only after acceptance', async () => {
        vi.useFakeTimers();
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error('network failure'))
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: { accepted: true } }),
            });
        vi.stubGlobal('fetch', fetch);
        const f = fixture();
        f.service.kick();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.repo.update).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(f.repo.update).toHaveBeenCalledTimes(1);
        f.service.onModuleDestroy();
    });
    it('HTTP success without the signed receiver acceptance never removes a pending event', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: false }) }),
        );
        const f = fixture();
        f.service.kick();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.repo.update).not.toHaveBeenCalled();
        f.service.onModuleDestroy();
    });
});

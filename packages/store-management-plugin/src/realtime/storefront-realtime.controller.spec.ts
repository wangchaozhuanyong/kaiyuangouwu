import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontRealtimeController } from './storefront-realtime.controller';

const HEARTBEAT_INTERVAL_MS = 15_000;
const BACKPRESSURE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2;

function createHarness() {
    const request = Object.assign(new EventEmitter(), {
        aborted: false,
        get: vi.fn(() => undefined),
    });
    const response = Object.assign(new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        status: vi.fn(),
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(() => true),
        destroy: vi.fn(),
    });
    response.status.mockReturnValue(response);

    const removeClient = vi.fn();
    const addClient = vi.fn(
        (_client: { send(payload: ReturnType<typeof realtimePayload>): void }) => removeClient,
    );
    const controller = new StorefrontRealtimeController(
        { addClient } as never,
        {
            resolveRequest: vi.fn(() => Promise.resolve({ channelId: 'store-a' })),
        } as never,
        { getSessionFromToken: vi.fn() } as never,
    );

    return {
        addClient,
        controller,
        removeClient,
        request,
        response,
    };
}

function realtimePayload(id = 'event-1') {
    return {
        version: 1 as const,
        id,
        occurredAt: '2026-09-02T00:00:00.000Z',
        topics: ['catalog'] as const,
    };
}

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('StorefrontRealtimeController', () => {
    it.each([
        ['request close', 'request', 'close', false],
        ['request aborted', 'request', 'aborted', true],
        ['response close', 'response', 'close', false],
        ['response error', 'response', 'error', false],
    ] as const)('cleans up once after %s', async (_name, target, event, destroysResponse) => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        const writesBeforeDisconnect = harness.response.write.mock.calls.length;

        if (event === 'error') {
            harness[target].emit(event, new Error('response closed'));
        } else {
            harness[target].emit(event);
        }
        harness.request.emit('aborted');
        harness.request.emit('close');
        harness.response.emit('close');
        if (event !== 'error') harness.response.emit('error', new Error('response closed'));
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

        expect(harness.removeClient).toHaveBeenCalledOnce();
        expect(harness.response.destroy).toHaveBeenCalledTimes(destroysResponse ? 1 : 0);
        expect(harness.response.write).toHaveBeenCalledTimes(writesBeforeDisconnect);
    });

    it('does not register a client when the request aborted during access resolution', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        harness.request.aborted = true;

        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );

        expect(harness.addClient).not.toHaveBeenCalled();
        expect(harness.response.write).not.toHaveBeenCalled();
        expect(harness.response.destroy).toHaveBeenCalledOnce();
    });

    it.each(['destroyed', 'writableEnded'] as const)(
        'cleans up before a heartbeat writes to a %s response',
        async state => {
            vi.useFakeTimers();
            const harness = createHarness();
            await harness.controller.events(
                harness.request as unknown as Request,
                harness.response as unknown as Response,
            );
            const writesBeforeDisconnect = harness.response.write.mock.calls.length;

            harness.response[state] = true;
            vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

            expect(harness.removeClient).toHaveBeenCalledOnce();
            expect(harness.response.write).toHaveBeenCalledTimes(writesBeforeDisconnect);
        },
    );

    it('cleans up after an invalidation write throws', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        const client = harness.addClient.mock.calls[0][0];
        harness.response.write.mockImplementationOnce(() => {
            throw new Error('response closed');
        });

        expect(() => client.send(realtimePayload())).toThrow('response closed');

        expect(harness.removeClient).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
        expect(harness.removeClient).toHaveBeenCalledOnce();
    });

    it('cleans up without leaking a timer when a heartbeat write throws', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        harness.response.write.mockImplementationOnce(() => {
            throw new Error('response closed');
        });

        expect(() => vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)).not.toThrow();
        expect(harness.removeClient).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
        expect(harness.removeClient).toHaveBeenCalledOnce();
    });

    it('waits for drain without treating backpressure as a write failure', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        const client = harness.addClient.mock.calls[0][0];
        harness.response.write.mockReturnValueOnce(false);

        expect(() => client.send(realtimePayload())).not.toThrow();
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

        expect(harness.removeClient).not.toHaveBeenCalled();
        expect(harness.response.write).toHaveBeenCalledTimes(2);

        harness.response.emit('drain');
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

        expect(harness.removeClient).not.toHaveBeenCalled();
        expect(harness.response.write).toHaveBeenCalledTimes(3);
    });

    it('closes a response whose backpressure does not drain', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        const client = harness.addClient.mock.calls[0][0];
        harness.response.write.mockReturnValueOnce(false);

        client.send(realtimePayload());
        vi.advanceTimersByTime(BACKPRESSURE_TIMEOUT_MS - 1);
        expect(harness.removeClient).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);

        expect(harness.removeClient).toHaveBeenCalledOnce();
        expect(harness.response.destroy).toHaveBeenCalledOnce();
    });

    it('closes a backpressured response instead of buffering another invalidation', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.events(
            harness.request as unknown as Request,
            harness.response as unknown as Response,
        );
        const client = harness.addClient.mock.calls[0][0];
        harness.response.write.mockReturnValueOnce(false);

        client.send(realtimePayload('event-1'));
        const writesAfterBackpressure = harness.response.write.mock.calls.length;
        client.send(realtimePayload('event-2'));
        client.send(realtimePayload('event-3'));

        expect(harness.response.write).toHaveBeenCalledTimes(writesAfterBackpressure);
        expect(harness.removeClient).toHaveBeenCalledOnce();
        expect(harness.response.destroy).toHaveBeenCalledOnce();
    });
});

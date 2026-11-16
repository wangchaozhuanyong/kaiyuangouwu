import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { GptRechargeStreamController } from './stream.controller';

const input = { id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) };
function response() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        headersSent: false,
        destroyed: false,
        statusCode: 0,
        setHeader: vi.fn(),
        flushHeaders() {
            this.headersSent = true;
        },
        status(value: number) {
            this.statusCode = value;
            return this;
        },
        set: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(() => emitter.emit('close')),
    });
}
const request = () => Object.assign(new EventEmitter(), { ip: '203.0.113.10', headers: {} });

describe('private recharge stream boundary', () => {
    it('uses the verified host channel and closes the executor stream after the terminal event', async () => {
        const ctx = { channelId: 7 };
        const context = { create: vi.fn().mockResolvedValue(ctx) };
        const access = {
            resolveRequest: vi.fn().mockResolvedValue({ ctx: { channel: 'verified-channel' } }),
        };
        let signal: AbortSignal | undefined;
        const service = {
            watchTask: vi.fn((_ctx, _id, _credential, abort, ready, send) => {
                signal = abort;
                ready();
                send({ id: input.id, status: 'succeeded' });
                return Promise.resolve();
            }),
        };
        const controller = new GptRechargeStreamController(
            context as never,
            access as never,
            service as never,
        );
        const req = request();
        const res = response();
        await controller.stream(input, req as never, res as never);
        expect(context.create).toHaveBeenCalledWith({
            req,
            apiType: 'shop',
            channelOrToken: 'verified-channel',
        });
        expect(service.watchTask).toHaveBeenCalledWith(
            ctx,
            input.id,
            input.credential,
            expect.any(AbortSignal),
            expect.any(Function),
            expect.any(Function),
        );
        expect(signal?.aborted).toBe(true);
        expect(res.end).toHaveBeenCalledOnce();
        expect(res.write.mock.calls.map(args => args[0]).join('')).toContain('succeeded');
    });
    it('denies malformed credentials and unresolved store hosts before opening a stream', async () => {
        const service = { watchTask: vi.fn() };
        const controller = new GptRechargeStreamController(
            {} as never,
            { resolveRequest: vi.fn().mockResolvedValue(null) } as never,
            service as never,
        );
        for (const [body, code] of [
            [{ ...input, credential: 'invalid' }, 400],
            [input, 403],
        ] as const) {
            const res = response();
            await controller.stream(body, request() as never, res as never);
            expect(res.statusCode).toBe(code);
            expect(res.write).not.toHaveBeenCalled();
        }
        expect(service.watchTask).not.toHaveBeenCalled();
    });
    it('bounds connections and releases their slots when clients disconnect', async () => {
        const service = {
            watchTask: vi.fn(async (_ctx, _id, _credential, signal, ready) => {
                ready();
                await new Promise<void>(resolve =>
                    signal.addEventListener('abort', () => resolve(), { once: true }),
                );
            }),
        };
        const controller = new GptRechargeStreamController(
            { create: vi.fn().mockResolvedValue({}) } as never,
            { resolveRequest: vi.fn().mockResolvedValue({ ctx: { channel: 'store' } }) } as never,
            service as never,
        );
        const responses = Array.from({ length: 8 }, response);
        const work = responses.map(entry => controller.stream(input, request() as never, entry as never));
        await new Promise(resolve => setTimeout(resolve, 0));
        const denied = response();
        await controller.stream(input, request() as never, denied as never);
        expect(denied.statusCode).toBe(429);
        responses.forEach(entry => entry.emit('close'));
        await Promise.all(work);
        const res = response();
        const next = controller.stream(input, request() as never, res as never);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(res.statusCode).toBe(200);
        res.emit('close');
        await next;
    });
});

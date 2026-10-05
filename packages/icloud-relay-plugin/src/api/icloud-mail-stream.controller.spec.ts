import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcloudMailStreamController } from './icloud-mail-stream.controller';

function fixture(target: Record<string, unknown> = { virtual: { id: 'v1', primaryAccount: { id: 'p1' } } }) {
    let listener: (event: unknown) => void = () => undefined;
    const authorizeQueryTarget = vi.fn().mockResolvedValue(target);
    const unsubscribe = vi.fn();
    const repo = {
        findOne: vi.fn().mockResolvedValue({ id: 12 }),
        find: vi.fn().mockResolvedValue([{ id: 12 }]),
    };
    const controller = new IcloudMailStreamController(
        { create: vi.fn().mockResolvedValue({}) } as never,
        { getRepository: () => repo } as never,
        { authorizeQueryTarget } as never,
        {
            subscribe: (fn: typeof listener) => {
                listener = fn;
                return unsubscribe;
            },
        } as never,
        {},
    );
    const req = Object.assign(new EventEmitter(), { ip: '127.0.0.1', get: () => undefined });
    const res = Object.assign(new EventEmitter(), {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn().mockReturnValue(true),
        status: vi.fn(),
        json: vi.fn(),
        end: vi.fn(),
        writableEnded: false,
        headersSent: false,
    });
    res.status.mockReturnValue(res);
    res.json.mockImplementation(() => {
        res.emit('close');
        return res;
    });
    res.end.mockImplementation(() => {
        res.writableEnded = true;
        res.emit('close');
    });
    const stream = (cursor?: string) =>
        controller.stream({ queryCode: 'BUY-AAAA-BBBB', cursor }, req as never, res as never);
    return {
        controller,
        authorizeQueryTarget,
        repo,
        req,
        res,
        unsubscribe,
        stream,
        emit: (event: unknown) => listener(event),
    };
}
afterEach(() => vi.useRealTimers());

describe('query-code scoped mailbox stream', () => {
    it('scopes replay and notifications to the buyer; idle heartbeat does no database work', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await f.stream('7');
        expect(f.repo.findOne.mock.calls[0][0].where).toEqual({ virtualEmailId: 'v1' });
        expect(f.repo.find.mock.calls[0][0].where.virtualEmailId).toBe('v1');
        expect(f.res.write.mock.calls[0][0]).toContain('"recovered":true');
        expect(f.res.write.mock.calls[0][0]).not.toMatch(/BUY-|p1|v1|bodyText|extractedCode/);
        f.emit({ kind: 'mail', eventId: 'other', virtualEmailId: 'v2', primaryAccountId: 'p1' });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.authorizeQueryTarget).toHaveBeenCalledTimes(1);
        expect(f.repo.findOne).toHaveBeenCalledTimes(1);
        expect(f.repo.find).toHaveBeenCalledTimes(1);
        expect(f.res.write.mock.calls.filter(([frame]) => frame.startsWith('event: mail'))).toHaveLength(0);
        f.emit({
            kind: 'mail',
            eventId: 'new-mail',
            cursor: '13',
            virtualEmailId: 'v1',
            primaryAccountId: 'p1',
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.res.write.mock.calls.some(([frame]) => frame.includes('"eventId":"new-mail"'))).toBe(true);
        f.res.emit('close');
        expect(f.unsubscribe).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('includes every alias of a master mailbox and buffers a commit during snapshot reading', async () => {
        const f = fixture({ primary: { id: 'p1' } });
        f.repo.findOne.mockImplementation(() => {
            f.emit({
                kind: 'mail',
                eventId: 'during-snapshot',
                cursor: '13',
                virtualEmailId: 'v2',
                primaryAccountId: 'p1',
            });
            return Promise.resolve({ id: 12 });
        });
        await f.stream();
        await new Promise(resolve => setImmediate(resolve));
        expect(f.repo.findOne.mock.calls[0][0].where).toEqual({ primaryAccountId: 'p1' });
        expect(f.res.write.mock.calls.some(([frame]) => frame.includes('during-snapshot'))).toBe(true);
        f.res.emit('close');
    });

    it('checks access again on revocation and ends the subscription without disclosing mail', async () => {
        const f = fixture();
        await f.stream();
        f.authorizeQueryTarget.mockResolvedValue({ error: 'disabled' });
        f.emit({ kind: 'access', eventId: 'revoked' });
        await new Promise(resolve => setImmediate(resolve));
        expect(f.res.write.mock.calls.some(([frame]) => frame.startsWith('event: access-denied'))).toBe(true);
        expect(f.res.end).toHaveBeenCalledOnce();
        expect(f.unsubscribe).toHaveBeenCalledOnce();
    });

    it('closes on expiry without periodic authorization queries', async () => {
        vi.useFakeTimers();
        const f = fixture({
            virtual: { id: 'v1', codeExpiresAt: new Date(Date.now() + 1000), primaryAccount: {} },
        });
        await f.stream();
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.res.end).toHaveBeenCalledOnce();
        expect(f.authorizeQueryTarget).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        [{ error: 'invalid code' }, 403],
        [{ primary: { id: 'p1', lastSyncError: '邮箱服务不支持实时收信，请使用手动同步' } }, 409],
    ])('rejects unavailable or unauthorized subscriptions before reading history', async (target, status) => {
        const f = fixture(target);
        await f.stream();
        expect(f.res.status).toHaveBeenCalledWith(status);
        expect(f.repo.findOne).not.toHaveBeenCalled();
    });

    it('releases the per-IP connection allowance when clients disconnect', async () => {
        const f = fixture();
        for (let i = 0; i < 9; i++) {
            // Each connection uses its own response, like real HTTP requests.
            const response = Object.assign(new EventEmitter(), {
                setHeader: vi.fn(),
                flushHeaders: vi.fn(),
                write: () => true,
                writableEnded: false,
                status: vi.fn(),
                json: vi.fn(),
                end: vi.fn(),
            });
            response.status.mockReturnValue(response);
            await f.controller.stream({ queryCode: 'BUY-AAAA-BBBB' }, f.req as never, response as never);
            expect(response.status).toHaveBeenCalledWith(200);
            response.emit('close');
        }
    });
});

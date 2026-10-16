import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IcloudAccountStatus } from '../types';

import { IcloudIdleService } from './icloud-idle.service';

const state = vi.hoisted(() => ({
    idle: true,
    connectFailure: undefined as Error | undefined,
    clients: [] as Array<{
        capabilities: Set<string>;
        usable: boolean;
        mailboxOpen: ReturnType<typeof vi.fn>;
        emit: (name: string) => void;
        close: () => void;
    }>,
}));
vi.mock('imapflow', async () => {
    const { EventEmitter } = await import('node:events');
    return {
        ImapFlow: class extends EventEmitter {
            capabilities = new Set(state.idle ? ['IDLE'] : []);
            usable = false;
            constructor() {
                super();
                state.clients.push(this);
            }
            connect() {
                if (state.connectFailure) {
                    const error = state.connectFailure;
                    state.connectFailure = undefined;
                    return Promise.reject(error);
                }
                this.usable = true;
                return Promise.resolve();
            }
            mailboxOpen = vi.fn().mockResolvedValue({ path: 'INBOX' });
            close() {
                this.usable = false;
                this.emit('close');
            }
        },
    };
});
beforeEach(() => {
    state.idle = true;
    state.connectFailure = undefined;
    state.clients.length = 0;
    vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function fixture() {
    const account = {
        id: '1',
        status: IcloudAccountStatus.ACTIVE,
        email: 'fixture@example.test',
        encryptedAppPassword: 'encrypted-fixture',
        imapHost: 'imap.mail.me.com',
        imapPort: 993,
    };
    const execute = vi.fn().mockResolvedValue({ affected: 1 });
    const builder = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute,
    };
    const repo = {
        find: vi.fn().mockResolvedValue([account]),
        findOneBy: vi.fn().mockResolvedValue(account),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: () => builder,
    };
    const sync = { syncAccount: vi.fn().mockResolvedValue({ success: true }) };
    const service = new IcloudIdleService(
        { getRepository: () => repo } as never,
        { decrypt: () => 'synthetic-fixture' } as never,
        sync as never,
        { isServer: true } as never,
    );
    return { service, repo, sync, execute, account, builder };
}
describe('event-driven IMAP IDLE', () => {
    it('a changed credential is not reported healthy by the old socket and only the current recovery replaces it', async () => {
        const f = fixture();
        await f.service.ensureWatching('1');
        await vi.advanceTimersByTimeAsync(0);
        const oldAccount = { ...f.account };
        const lease = f.builder.set.mock.calls[0][0];
        f.account.encryptedAppPassword = 'new-encrypted-fixture';
        expect(f.service.health({ ...f.account, ...lease } as never)).toMatchObject({
            state: 'recovering',
            reason: 'reconnecting',
        });
        await f.service.ensureWatching('1', oldAccount as never);
        expect(state.clients).toHaveLength(1);
        await f.service.ensureWatching('1', f.account as never);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.clients).toHaveLength(2);
        expect(state.clients[0].usable).toBe(false);
        await f.service.onModuleDestroy();
    });
    it('starts receiving subsequent messages after a stopped authentication failure is corrected', async () => {
        const f = fixture();
        state.connectFailure = Object.assign(new Error('synthetic expired authorization'), {
            authenticationFailed: true,
        });
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.repo.update).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: IcloudAccountStatus.AUTH_ERROR }),
        );
        expect(f.sync.syncAccount).not.toHaveBeenCalled();
        await f.service.ensureWatching('1', f.account as never);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.clients).toHaveLength(2);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        state.clients[1].emit('exists');
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        await f.service.onModuleDestroy();
    });
    it('merges concurrent recovery and leaves a healthy listener and its socket intact', async () => {
        const f = fixture();
        await Promise.all([f.service.ensureWatching('1'), f.service.ensureWatching('1')]);
        await vi.advanceTimersByTimeAsync(0);
        await f.service.ensureWatching('1');
        expect(state.clients).toHaveLength(1);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        const lease = f.builder.set.mock.calls[0][0];
        expect(f.service.health({ ...f.account, ...lease } as never)).toMatchObject({
            state: 'listening',
            reason: 'connected',
        });
        state.clients[0].close();
        await f.service.ensureWatching('1');
        expect(state.clients).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1500);
        expect(state.clients).toHaveLength(2);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        await f.service.onModuleDestroy();
    });
    it('does not restart from a stale successful operation after disable or credential change', async () => {
        const f = fixture();
        const original = { ...f.account };
        f.account.status = IcloudAccountStatus.DISABLED;
        await f.service.ensureWatching('1', original as never);
        f.account.status = IcloudAccountStatus.ACTIVE;
        f.account.encryptedAppPassword = 'new-encrypted-fixture';
        await f.service.ensureWatching('1', original as never);
        expect(state.clients).toHaveLength(0);
        expect(f.sync.syncAccount).not.toHaveBeenCalled();
        await f.service.onModuleDestroy();
    });
    it('does not infer a healthy socket from an account flag or a different owner lease', () => {
        const f = fixture();
        expect(f.service.health(f.account as never)).toMatchObject({
            state: 'unknown',
            reason: 'not_started',
        });
        expect(
            f.service.health({
                ...f.account,
                mailWatchOwner: 'other',
                mailWatchLeaseUntil: new Date(Date.now() + 90_000),
            } as never),
        ).toMatchObject({ state: 'unknown', reason: 'owned_elsewhere' });
        expect(
            f.service.health({ ...f.account, status: IcloudAccountStatus.AUTH_ERROR } as never),
        ).toMatchObject({ state: 'unavailable', reason: 'authorization_failed' });
    });
    it('catches up once, reads only on EXISTS, and reuses the listening socket', async () => {
        const f = fixture();
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        expect(f.sync.syncAccount.mock.calls[0][2]).toBe(state.clients[0]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        state.clients[0].emit('exists');
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        await f.service.onModuleDestroy();
        expect(state.clients[0].usable).toBe(false);
    });
    it('losing the owner election opens no socket and fetches no messages', async () => {
        const f = fixture();
        f.execute.mockResolvedValue({ affected: 0 });
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        expect(state.clients).toHaveLength(0);
        expect(f.sync.syncAccount).not.toHaveBeenCalled();
        await f.service.onModuleDestroy();
    });
    it('stopped listeners cannot fetch on a late EXISTS event', async () => {
        const f = fixture();
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        await f.service.onModuleDestroy();
        const count = f.sync.syncAccount.mock.calls.length;
        state.clients[0].emit('exists');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(count);
    });
    it('reconnects with one catch-up and ignores events from the closed socket', async () => {
        const f = fixture();
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        const original = state.clients[0];
        original.close();
        original.emit('exists');
        await vi.advanceTimersByTimeAsync(1500);
        expect(state.clients).toHaveLength(2);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        original.emit('exists');
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        await f.service.onModuleDestroy();
    });
    it('unsupported IDLE stops without a polling fallback', async () => {
        const f = fixture();
        state.idle = false;
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.sync.syncAccount).not.toHaveBeenCalled();
        await f.service.onModuleDestroy();
    });
    it('reconnection during an unfinished sync preserves its catch-up event', async () => {
        const f = fixture();
        let failOriginal!: (reason: Error) => void;
        f.sync.syncAccount.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    failOriginal = reject;
                }),
        );
        await f.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);
        state.clients[0].close();
        await vi.advanceTimersByTimeAsync(1500);
        expect(state.clients).toHaveLength(2);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        failOriginal(new Error('closed original socket'));
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
        expect(f.sync.syncAccount.mock.calls[1][2]).toBe(state.clients[1]);
        expect(state.clients[1].usable).toBe(true);
        await f.service.onModuleDestroy();
    });
});

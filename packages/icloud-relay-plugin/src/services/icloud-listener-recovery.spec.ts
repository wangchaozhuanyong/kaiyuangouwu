import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ICLOUD_IDLE_UNSUPPORTED_ERROR } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudAccountStatus } from '../types';

import { IcloudAdminService } from './icloud-admin.service';

describe('manual success restores realtime listening independently', () => {
    it('merges simultaneous sync requests for the same mailbox and permits a later explicit sync', async () => {
        const f = fixture();
        let complete!: (result: { success: boolean; syncedCount: number }) => void;
        f.sync.syncAccount.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const first = f.service.syncPrimaryAccount({} as RequestContext, f.account.id);
        const second = f.service.syncPrimaryAccount({} as RequestContext, f.account.id);
        await Promise.resolve();
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(1);
        complete({ success: true, syncedCount: 1 });
        expect(await Promise.all([first, second])).toEqual([
            { success: true, syncedCount: 1 },
            { success: true, syncedCount: 1 },
        ]);
        expect(f.idle.ensureWatching).toHaveBeenCalledTimes(1);
        await f.service.syncPrimaryAccount({} as RequestContext, f.account.id);
        expect(f.sync.syncAccount).toHaveBeenCalledTimes(2);
    });
    function fixture() {
        const account = new IcloudPrimaryAccount({
            id: 'primary-1',
            email: 'fixture@example.test',
            status: IcloudAccountStatus.AUTH_ERROR,
            encryptedAppPassword: 'encrypted-fixture',
            lastSyncError: 'authorization failed',
        });
        const repo = {
            findOne: vi.fn().mockResolvedValue(account),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const sync = {
            testConnection: vi.fn().mockResolvedValue({ success: true }),
            syncAccount: vi.fn().mockResolvedValue({ success: true, syncedCount: 1 }),
        };
        const idle = { ensureWatching: vi.fn().mockResolvedValue(undefined) };
        const service = new IcloudAdminService(
            { getRepository: () => repo } as never,
            {} as never,
            {} as never,
            sync as never,
            {} as never,
            {} as never,
            idle as never,
        );
        return { account, repo, sync, idle, service };
    }
    it.each(['test', 'sync'])(
        'successful %s checks listener recovery against the original credentials',
        async action => {
            const f = fixture();
            if (action === 'test') await f.service.testConnection({} as RequestContext, f.account.id);
            else await f.service.syncPrimaryAccount({} as RequestContext, f.account.id);
            expect(f.idle.ensureWatching).toHaveBeenCalledExactlyOnceWith('primary-1', f.account);
        },
    );
    it('a failed connection test does not restart the listener', async () => {
        const f = fixture();
        f.sync.testConnection.mockResolvedValue({ success: false });
        await f.service.testConnection({} as RequestContext, f.account.id);
        expect(f.idle.ensureWatching).not.toHaveBeenCalled();
    });
    it('manual connection success retains the unsupported-IDLE reason', async () => {
        const f = fixture();
        f.account.status = IcloudAccountStatus.ACTIVE;
        f.account.lastSyncError = ICLOUD_IDLE_UNSUPPORTED_ERROR;
        await f.service.testConnection({} as RequestContext, f.account.id);
        expect(f.repo.update.mock.calls[0][1]).toMatchObject({
            lastSyncError: ICLOUD_IDLE_UNSUPPORTED_ERROR,
        });
    });
    it('a committed manual sync is not reported as failed when listener recovery is unavailable', async () => {
        const f = fixture();
        f.idle.ensureWatching.mockRejectedValue(new Error('synthetic metadata failure'));
        await expect(f.service.syncPrimaryAccount({} as RequestContext, f.account.id)).resolves.toMatchObject(
            { success: true, syncedCount: 1 },
        );
    });
});

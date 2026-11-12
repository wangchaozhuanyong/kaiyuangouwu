import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudAccountStatus } from '../types';

import { IcloudMailHealthService } from './icloud-mail-health.service';

describe('mail health is metadata only', () => {
    it('returns controlled listener states and delivery metadata without exposing account secrets', async () => {
        const accounts = [
            {
                id: '1',
                status: IcloudAccountStatus.ACTIVE,
                lastSyncedUidValidity: '42',
                encryptedAppPassword: 'fixture-encrypted-password',
                masterQueryCode: 'fixture-code',
            },
        ];
        const idle = {
            health: vi.fn().mockReturnValue({
                primaryAccountId: '1',
                state: 'unknown',
                reason: 'not_started',
                leaseExpiresAt: null,
            }),
            ensureWatching: vi.fn(),
        };
        const events = {
            health: vi.fn().mockResolvedValue({
                configured: false,
                pendingCount: 2,
                oldestPendingAt: new Date(),
                lastDeliveredAt: null,
            }),
            kick: vi.fn(),
        };
        const arrival = {
            read: vi.fn().mockResolvedValue({ outcome: 'measured', arrivalToStoreMs: [1200] }),
        };
        const service = new IcloudMailHealthService(
            { getRepository: () => ({ find: () => accounts }) } as never,
            idle as never,
            events as never,
            arrival as never,
        );
        const result = await service.read({} as RequestContext);
        expect(result.listeners[0]).toMatchObject({ state: 'unknown' });
        expect(result.delivery).toMatchObject({ configured: false, pendingCount: 2 });
        expect(JSON.stringify(result)).not.toMatch(/fixture-encrypted-password|fixture-code/);
        expect(idle.ensureWatching).not.toHaveBeenCalled();
        expect(events.kick).not.toHaveBeenCalled();
        expect(arrival.read).not.toHaveBeenCalled();

        const platform = { channel: { code: DEFAULT_CHANNEL_CODE } } as RequestContext;
        expect((await service.read(platform, '1')).arrivalSample).toMatchObject({
            arrivalToStoreMs: [1200],
        });
        expect(arrival.read).toHaveBeenCalledExactlyOnceWith(platform, accounts[0]);
        expect(
            (await service.read({ channel: { code: 'store' } } as RequestContext, '1')).arrivalSample,
        ).toBeNull();
        expect((await service.read(platform, 'different')).arrivalSample).toBeNull();
        accounts[0].status = IcloudAccountStatus.DISABLED;
        expect((await service.read(platform, '1')).arrivalSample).toBeNull();
        expect(arrival.read).toHaveBeenCalledTimes(1);
    });
});

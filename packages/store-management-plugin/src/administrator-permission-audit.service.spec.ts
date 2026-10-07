import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AdministratorPermissionAuditService } from './administrator-permission-audit.service';
import { AdministratorAccessProfile } from './entities/administrator-access-profile.entity';

function fixture(code = 'shop-a', permission: string | null = Permission.SuperAdmin) {
    const profile = {
        findOne: vi.fn().mockResolvedValue({ scope: 'PLATFORM', authority: 'OWNER', status: 'ACTIVE' }),
    };
    const audit = { find: vi.fn().mockResolvedValue([{ id: 'audit' }]) };
    const service = new AdministratorPermissionAuditService(
        {
            getRepository: vi.fn((_ctx, entity) => (entity === AdministratorAccessProfile ? profile : audit)),
        } as any,
        {} as any,
    );
    const ctx = {
        activeUserId: 'user',
        channelId: code === DEFAULT_CHANNEL_CODE ? 'default' : 'shop-a',
        channel: { code },
        userHasPermissions: (permissions: string[]) => permission != null && permissions.includes(permission),
    } as unknown as RequestContext;
    return { service, profile, audit, ctx };
}
describe('permission audit context', () => {
    it('allows an authorized platform administrator to read across stores from the default context', async () => {
        const f = fixture(DEFAULT_CHANNEL_CODE);
        expect(await f.service.findVisible(f.ctx)).toEqual([{ id: 'audit' }]);
        expect(f.audit.find).toHaveBeenCalledWith({
            where: undefined,
            order: { createdAt: 'DESC' },
            take: 200,
        });
    });

    it('limits the same platform Owner/SuperAdmin to current-store rows in an operating context', async () => {
        const f = fixture();
        await f.service.findVisible(f.ctx);
        expect(f.audit.find).toHaveBeenCalledWith({
            where: { channelId: 'shop-a' },
            order: { createdAt: 'DESC' },
            take: 200,
        });
        await expect(f.service.findVisible(f.ctx, 'shop-b')).rejects.toThrow();
        expect(f.profile.findOne).toHaveBeenCalledTimes(1);
    });

    it('rejects a store administrator identity bound to another Channel', async () => {
        const f = fixture();
        f.profile.findOne.mockResolvedValue({
            scope: 'STORE',
            authority: 'ADMIN',
            status: 'ACTIVE',
            channelId: 'shop-b',
        } as any);
        await expect(f.service.findVisible(f.ctx)).rejects.toThrow();
        expect(f.audit.find).not.toHaveBeenCalled();
    });

    it('keeps the own-store team audit available without platform permission', async () => {
        const f = fixture('shop-a', 'ManageStoreTeam');
        f.profile.findOne.mockResolvedValue({
            scope: 'STORE',
            authority: 'ADMIN',
            status: 'ACTIVE',
            channelId: 'shop-a',
        } as any);
        await f.service.findVisible(f.ctx, 'shop-a');
        expect(f.audit.find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'shop-a' } }),
        );
    });

    it('does not return records for suspended identities or missing team-read permissions', async () => {
        const f = fixture('shop-a', null);
        expect(await f.service.findVisible(f.ctx)).toEqual([]);
        f.profile.findOne.mockResolvedValue({ scope: 'PLATFORM', authority: 'OWNER', status: 'SUSPENDED' });
        expect(await f.service.findVisible(f.ctx)).toEqual([]);
        expect(f.audit.find).not.toHaveBeenCalled();
    });
});

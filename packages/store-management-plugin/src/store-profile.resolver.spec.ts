import { Permission } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreProfileAdminResolver } from './store-profile.resolver';

describe('StoreProfileAdminResolver', () => {
    const resolver = new StoreProfileAdminResolver({} as any, {} as any, {} as any);

    it('returns internal notes only to SuperAdmins', () => {
        const profile = { internalNote: '平台审核记录' };

        expect(
            resolver.internalNote({ userHasPermissions: vi.fn().mockReturnValue(true) } as any, profile),
        ).toBe('平台审核记录');
        expect(
            resolver.internalNote({ userHasPermissions: vi.fn().mockReturnValue(false) } as any, profile),
        ).toBeNull();
    });

    it('checks the SuperAdmin permission explicitly', () => {
        const userHasPermissions = vi.fn().mockReturnValue(false);

        resolver.internalNote({ userHasPermissions } as any, { internalNote: 'secret' });

        expect(userHasPermissions).toHaveBeenCalledWith([Permission.SuperAdmin]);
    });

    it('routes suspension through the guarded lifecycle operation', async () => {
        const passwordService = { assertCurrentPassword: vi.fn() };
        const profileService = { update: vi.fn() };
        const guardedResolver = new StoreProfileAdminResolver(
            profileService as any,
            {} as any,
            passwordService as any,
        );

        await expect(
            guardedResolver.updateStoreProfile(
                {} as any,
                {
                    id: 'profile-1',
                    expectedUpdatedAt: new Date(),
                    status: 'SUSPENDED',
                } as any,
            ),
        ).rejects.toThrow('暂停营业必须使用安全清退入口');
        expect(passwordService.assertCurrentPassword).not.toHaveBeenCalled();
        expect(profileService.update).not.toHaveBeenCalled();
    });

    it('requires the current password for ordinary status changes', async () => {
        const passwordService = { assertCurrentPassword: vi.fn() };
        const profileService = { update: vi.fn().mockResolvedValue({ id: 'profile-1' }) };
        const guardedResolver = new StoreProfileAdminResolver(
            profileService as any,
            {} as any,
            passwordService as any,
        );
        const input = {
            id: 'profile-1',
            expectedUpdatedAt: new Date(),
            status: 'ACTIVE' as const,
            currentPassword: 'verified-password',
        };

        await guardedResolver.updateStoreProfile({} as any, input);

        expect(passwordService.assertCurrentPassword).toHaveBeenCalledWith(
            expect.anything(),
            'verified-password',
        );
        expect(profileService.update).toHaveBeenCalledWith(expect.anything(), input);
    });
});

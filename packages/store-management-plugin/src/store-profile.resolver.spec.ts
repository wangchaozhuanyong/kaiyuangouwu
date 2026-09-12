import { Permission } from '@vendure/core';
import { buildSchema, coerceInputValue, isInputObjectType, print } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

import { storeProfileInputSchema } from './store-profile-input.schema';
import { StoreProfileAdminResolver } from './store-profile.resolver';

describe('StoreProfileAdminResolver', () => {
    const resolver = new StoreProfileAdminResolver({} as any, {} as any, {} as any);

    it('exposes seller rebinding only on the platform admin input, not the merchant input', () => {
        const schema = buildSchema(`scalar DateTime
            enum StoreProfileStatus { DRAFT ACTIVE SUSPENDED }
            type Query { probe: Boolean }
            ${print(storeProfileInputSchema)}`);
        const adminInput = schema.getType('UpdateStoreProfileInput');
        const merchantInput = schema.getType('UpdateMyStoreProfileInput');
        if (!isInputObjectType(adminInput) || !isInputObjectType(merchantInput))
            throw new Error('Missing profile input schema');
        expect(() =>
            coerceInputValue(
                { id: 'profile-1', expectedUpdatedAt: '2026-09-12', sellerId: 'seller-2' },
                adminInput,
            ),
        ).not.toThrow();
        expect(() =>
            coerceInputValue({ expectedUpdatedAt: '2026-09-12', sellerId: 'seller-2' }, merchantInput),
        ).toThrow('sellerId');
    });

    it('requires one password check when changing seller and status together', async () => {
        const passwordService = { assertCurrentPassword: vi.fn() };
        const profileService = { update: vi.fn() };
        const guarded = new StoreProfileAdminResolver(
            profileService as any,
            {} as any,
            passwordService as any,
        );
        const input = {
            id: 'profile-1',
            expectedUpdatedAt: new Date(),
            sellerId: 'seller-2',
            status: 'ACTIVE' as const,
            currentPassword: 'test-password',
        };
        await guarded.updateStoreProfile({} as any, input);
        expect(passwordService.assertCurrentPassword).toHaveBeenCalledTimes(1);
        expect(profileService.update).toHaveBeenCalledWith(expect.anything(), input);
    });

    it('rejects a seller-only update before any write when password verification fails', async () => {
        const passwordService = {
            assertCurrentPassword: vi.fn().mockRejectedValue(new Error('密码验证失败')),
        };
        const profileService = { update: vi.fn() };
        const guarded = new StoreProfileAdminResolver(
            profileService as any,
            {} as any,
            passwordService as any,
        );
        await expect(
            guarded.updateStoreProfile({} as any, {
                id: 'profile-1',
                expectedUpdatedAt: new Date(),
                sellerId: 'seller-2',
            }),
        ).rejects.toThrow('密码验证失败');
        expect(passwordService.assertCurrentPassword).toHaveBeenCalledWith(expect.anything(), '');
        expect(profileService.update).not.toHaveBeenCalled();
    });

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

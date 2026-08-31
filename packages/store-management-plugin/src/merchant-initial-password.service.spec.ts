import { ForbiddenError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';

function createService(access: StoreAdministratorAccess | null = null, currentPasswordMatches = false) {
    const accessRepository = {
        findOne: vi.fn().mockResolvedValue(access),
        save: vi.fn(async value => value),
    };
    const authenticationMethod = { passwordHash: 'current-hash' };
    const userRepository = {
        createQueryBuilder: vi.fn(() => ({
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            addSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue({
                getNativeAuthenticationMethod: () => authenticationMethod,
            }),
        })),
    };
    const connection = {
        getRepository: vi.fn((_ctx, entity) =>
            entity === StoreAdministratorAccess ? accessRepository : userRepository,
        ),
    };
    const administratorService = {
        findOneByUserId: vi.fn().mockResolvedValue({ id: 'administrator-1' }),
        update: vi.fn().mockResolvedValue({ id: 'administrator-1' }),
    };
    const configService = {
        authOptions: {
            passwordValidationStrategy: { validate: vi.fn().mockReturnValue(true) },
        },
    };
    const passwordCipher = { check: vi.fn().mockResolvedValue(currentPasswordMatches) };
    const service = new MerchantInitialPasswordService(
        connection as any,
        administratorService as any,
        configService as any,
        passwordCipher as any,
    );
    return { accessRepository, administratorService, passwordCipher, service };
}

function pendingAccess() {
    return new StoreAdministratorAccess({
        id: 'access-1',
        administratorId: 'administrator-1',
        userId: 'user-1',
        mustChangePassword: true,
    });
}

describe('MerchantInitialPasswordService', () => {
    it('requires the current password before a sensitive operation', async () => {
        const accepted = createService(null, true);
        await expect(
            accepted.service.assertCurrentPassword({ activeUserId: 'user-1' } as any, 'Current123!'),
        ).resolves.toBeUndefined();

        const rejected = createService(null, false);
        await expect(
            rejected.service.assertCurrentPassword({ activeUserId: 'user-1' } as any, 'wrong'),
        ).rejects.toThrow('当前账号密码不正确');
    });

    it('requires the current password for protected core admin deletions', async () => {
        const accepted = createService(null, true);
        await expect(
            accepted.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'deleteCollections',
                'Current123!',
            ),
        ).resolves.toBeUndefined();

        const rejected = createService(null, false);
        await expect(
            rejected.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'deleteProducts',
                undefined,
            ),
        ).rejects.toThrow('当前账号密码不正确');
    });

    it('does not require a password for ordinary edits or low-risk deletions', async () => {
        const { service, passwordCipher } = createService(null, false);
        const ctx = { activeUserId: 'user-1', apiType: 'admin' } as any;

        await expect(
            service.assertSensitiveAdminMutation(ctx, 'updateProduct', undefined),
        ).resolves.toBeUndefined();
        await expect(
            service.assertSensitiveAdminMutation(ctx, 'deleteCustomerAddress', undefined),
        ).resolves.toBeUndefined();
        expect(passwordCipher.check).not.toHaveBeenCalled();
    });

    it('requires the current password only when updating the active administrator password', async () => {
        const passwordUpdate = createService(null, false);
        await expect(
            passwordUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateActiveAdministrator',
                undefined,
                { input: { password: 'SafePassword9!' } },
            ),
        ).rejects.toThrow('当前账号密码不正确');

        const profileUpdate = createService(null, false);
        await expect(
            profileUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateActiveAdministrator',
                undefined,
                { input: { firstName: '商家', lastName: '管理员' } },
            ),
        ).resolves.toBeUndefined();
        expect(profileUpdate.passwordCipher.check).not.toHaveBeenCalled();
    });

    it.each([
        'refundOrder',
        'settleRefund',
        'cancelOrder',
        'updateRole',
        'rotateApiKey',
        'adjustReferralBalance',
        'processReferralWithdrawal',
    ])('requires the current password for %s', async fieldName => {
        const rejected = createService(null, false);
        await expect(
            rejected.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                fieldName,
                undefined,
            ),
        ).rejects.toThrow('当前账号密码不正确');
    });

    it('requires the current password only when a bulk product update changes enabled state', async () => {
        const protectedUpdate = createService(null, false);
        await expect(
            protectedUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateProducts',
                undefined,
                { input: [{ id: 'product-1', enabled: false }] },
            ),
        ).rejects.toThrow('当前账号密码不正确');

        const ordinaryUpdate = createService(null, false);
        await expect(
            ordinaryUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateProductVariants',
                undefined,
                { input: [{ id: 'variant-1', facetValueIds: ['facet-value-1'] }] },
            ),
        ).resolves.toBeUndefined();
        expect(ordinaryUpdate.passwordCipher.check).not.toHaveBeenCalled();
    });

    it('requires the current password only when a single product update changes enabled state', async () => {
        const protectedUpdate = createService(null, false);
        await expect(
            protectedUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateProduct',
                undefined,
                { input: { id: 'product-1', enabled: true } },
            ),
        ).rejects.toThrow('当前账号密码不正确');

        const ordinaryUpdate = createService(null, false);
        await expect(
            ordinaryUpdate.service.assertSensitiveAdminMutation(
                { activeUserId: 'user-1', apiType: 'admin' } as any,
                'updateProduct',
                undefined,
                { input: { id: 'product-1', facetValueIds: ['facet-value-1'] } },
            ),
        ).resolves.toBeUndefined();
        expect(ordinaryUpdate.passwordCipher.check).not.toHaveBeenCalled();
    });

    it('blocks unrelated Admin API root fields while the temporary password is active', async () => {
        const { service } = createService(pendingAccess());
        const ctx = { apiType: 'admin', activeUserId: 'user-1' } as any;

        await expect(service.assertRootFieldAccess(ctx, 'Query', 'orders')).rejects.toBeInstanceOf(
            ForbiddenError,
        );
        await expect(
            service.assertRootFieldAccess(ctx, 'Query', 'merchantInitialPasswordStatus'),
        ).resolves.toBeUndefined();
        await expect(
            service.assertRootFieldAccess(ctx, 'Mutation', 'completeInitialPasswordChange'),
        ).resolves.toBeUndefined();
    });

    it('changes the password and removes the gate in one service flow', async () => {
        const access = pendingAccess();
        const { accessRepository, administratorService, service } = createService(access);
        const ctx = { apiType: 'admin', activeUserId: 'user-1' } as any;

        await expect(service.complete(ctx, 'Safe123!')).resolves.toEqual({
            mustChangePassword: false,
        });
        expect(administratorService.update).toHaveBeenCalledWith(ctx, {
            id: 'administrator-1',
            password: 'Safe123!',
        });
        expect(access.mustChangePassword).toBe(false);
        expect(accessRepository.save).toHaveBeenCalledWith(access);
    });

    it('rejects a weak or unchanged password', async () => {
        const weak = createService(pendingAccess());
        await expect(weak.service.complete({ activeUserId: 'user-1' } as any, 'short1!')).rejects.toThrow(
            '至少 8 位',
        );

        const unchanged = createService(pendingAccess(), true);
        await expect(
            unchanged.service.complete({ activeUserId: 'user-1' } as any, 'SecurePassword9!'),
        ).rejects.toThrow('不能与临时密码相同');
        expect(unchanged.administratorService.update).not.toHaveBeenCalled();
    });
});

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
    return { accessRepository, administratorService, service };
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

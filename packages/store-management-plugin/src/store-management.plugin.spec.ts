import { Channel, PaymentMethod, Role } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    adjustReferralBalancePermission,
    manageReferralWithdrawalPermission,
    referralPermission,
} from './referral/referral.constants';
import { StoreManagementPlugin } from './store-management.plugin';

describe('StoreManagementPlugin promotion options', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        StoreManagementPlugin.init({ enabled: false });
    });

    it('requires a strong signing secret for the referral balance handler in production', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(() => StoreManagementPlugin.init({ enabled: false, signingSecret: 'short' })).toThrow(
            'at least 32 characters',
        );
    });

    it('still requires a strong secret when the promotion gate is disabled because referral payments use it', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(() => StoreManagementPlugin.init({ enabled: false, signingSecret: 'short' })).toThrow(
            'referral balance payment',
        );
    });

    it('enables secure cookies and removes development host bypasses by default in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('USDT_PAYMENT_PROOF_SECRET', 'production-usdt-proof-secret-that-is-long-enough');
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', 'production-wallet-encryption-key-that-is-long-enough');

        StoreManagementPlugin.init({
            signingSecret: 'production-promotion-secret-that-is-long-enough',
        });

        expect(StoreManagementPlugin.promotionOptions).toMatchObject({
            enabled: true,
            secureCookie: true,
            bypassHosts: [],
        });
    });

    it('upgrades store administrators with referral permissions without granting them to employees', async () => {
        const storeAdministrator = {
            id: 'role-admin',
            code: 'alpha-store-admin',
            permissions: [] as string[],
        };
        const employee = { id: 'role-employee', code: 'alpha-employee', permissions: [] as string[] };
        const roleRepository = {
            find: vi.fn().mockResolvedValue([storeAdministrator]),
            save: vi.fn().mockImplementation(role => Promise.resolve(role)),
        };
        const paymentMethodRepository = {
            findOne: vi.fn().mockResolvedValue({ id: 'referral-payment-method', enabled: true }),
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Channel) return { find: vi.fn().mockResolvedValue([{ id: 'channel-1' }]) };
                throw new Error(`Unexpected contextual repository ${String(entity)}`);
            }),
            rawConnection: {
                getRepository: vi.fn(entity => {
                    if (entity === PaymentMethod) return paymentMethodRepository;
                    if (entity === Role) return roleRepository;
                    throw new Error(`Unexpected raw repository ${String(entity)}`);
                }),
            },
        };
        const plugin = new StoreManagementPlugin(
            {} as any,
            connection as any,
            { create: vi.fn().mockResolvedValue({}) } as any,
            { create: vi.fn() } as any,
            {
                assignToChannels: vi.fn().mockResolvedValue(undefined),
                removeFromChannels: vi.fn().mockResolvedValue(undefined),
            } as any,
            { get: vi.fn().mockReturnValue({ enabled: false }) } as any,
            {
                seedLegacyWallet: vi.fn().mockResolvedValue(undefined),
                list: vi.fn().mockResolvedValue([]),
            } as any,
        );

        await plugin.onApplicationBootstrap();

        expect(storeAdministrator.permissions).toEqual(
            expect.arrayContaining([
                referralPermission.Create,
                referralPermission.Read,
                referralPermission.Update,
                referralPermission.Delete,
                manageReferralWithdrawalPermission.Permission,
                adjustReferralBalancePermission.Permission,
            ]),
        );
        expect(roleRepository.save).toHaveBeenCalledTimes(1);
        expect(roleRepository.save).toHaveBeenCalledWith(storeAdministrator, { reload: false });
        expect(employee.permissions).toEqual([]);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreUsdtWallet } from '../entities/store-usdt-wallet.entity';

import { StoreUsdtWalletService } from './store-usdt-wallet.service';
import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import { UsdtWalletConfigurationService } from './usdt-wallet-configuration.service';

describe('StoreUsdtWalletService', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('encrypts a merchant submission and only activates it after SuperAdmin review', async () => {
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', 'unit-test-wallet-encryption-key-that-is-long-enough');
        const channel = { id: 'channel-1', code: 'store-one' };
        let stored: StoreUsdtWallet | null = null;
        const repository = {
            findOne: vi.fn(() => Promise.resolve(stored ? Object.assign(stored, { channel }) : null)),
            find: vi.fn(() => Promise.resolve(stored ? [stored] : [])),
            save: vi.fn((wallet: StoreUsdtWallet) => {
                stored = Object.assign(wallet, { id: 'wallet-1', channel });
                return Promise.resolve(stored);
            }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StoreUsdtWallet ? repository : { find: vi.fn(() => Promise.resolve([channel])) },
            ),
            getEntityOrThrow: vi.fn(() => Promise.resolve(channel)),
            rawConnection: {
                getRepository: vi.fn(() => ({
                    findOne: vi.fn(() => Promise.resolve({ id: 'usdt-payment-method' })),
                })),
            },
        };
        const service = new StoreUsdtWalletService(connection as any, new UsdtWalletConfigurationService(), {
            assignToChannels: vi.fn().mockResolvedValue(undefined),
        } as any);

        const submitted = await service.submit(
            { channelId: channel.id, activeUserId: 'merchant-user' } as any,
            USDT_TRC20_CONTRACT_ADDRESS,
        );

        expect(submitted).toMatchObject({ reviewStatus: 'PENDING', configured: false });
        const submittedEntity = repository.save.mock.calls.at(-1)?.[0] as StoreUsdtWallet;
        expect(submittedEntity.pendingReceivingAddressEncrypted).not.toContain(USDT_TRC20_CONTRACT_ADDRESS);
        await expect(service.requireConfigured({ channelId: channel.id } as any)).rejects.toThrow(
            '尚未通过平台审核',
        );

        const approved = await service.review({ activeUserId: 'superadmin-user' } as any, {
            channelId: channel.id,
            approved: true,
        });
        const configuration = await service.requireConfigured({ channelId: channel.id } as any);

        expect(approved).toMatchObject({ reviewStatus: 'ACTIVE', configured: true });
        expect(configuration.receivingAddress).toBe(USDT_TRC20_CONTRACT_ADDRESS);
        const approvedEntity = repository.save.mock.calls.at(-1)?.[0] as StoreUsdtWallet;
        expect(approvedEntity.pendingReceivingAddressEncrypted).toBeNull();
    });
});

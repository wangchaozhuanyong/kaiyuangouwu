import { Channel, PaymentMethod } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreUsdtWalletAudit } from '../entities/store-usdt-wallet-audit.entity';
import { StoreUsdtWallet } from '../entities/store-usdt-wallet.entity';

import { StoreUsdtWalletService } from './store-usdt-wallet.service';
import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import {
    fingerprintReceivingAddress,
    UsdtWalletConfigurationService,
} from './usdt-wallet-configuration.service';

const replacementAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

describe('StoreUsdtWalletService', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('encrypts submissions, records audits and only activates a wallet after review', async () => {
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', 'unit-test-wallet-encryption-key-that-is-long-enough');
        const channel = { id: 'channel-1', code: 'store-one' } as Channel;
        let stored: StoreUsdtWallet | null = null;
        const audits: StoreUsdtWalletAudit[] = [];
        const walletRepository = {
            findOne: vi.fn(() => stored),
            find: vi.fn(() => (stored ? [stored] : [])),
            save: vi.fn((wallet: StoreUsdtWallet) => {
                stored = Object.assign(wallet, { id: 'wallet-1', channel });
                return stored;
            }),
            createQueryBuilder: vi.fn(() => lockedQuery(() => stored)),
        };
        const auditRepository = {
            save: vi.fn((audit: StoreUsdtWalletAudit) => {
                audits.push(audit);
                return audit;
            }),
        };
        const channelRepository = { find: vi.fn(() => [channel]) };
        const paymentMethodRepository = {
            find: vi.fn(() => [
                {
                    id: 'usdt-payment-method',
                    code: 'usdt-trc20',
                    enabled: true,
                    checker: null,
                    handler: { code: 'usdt-trc20-chain-handler', args: [] },
                    translations: [{ languageCode: 'en', name: 'USDT', description: 'USDT' }],
                    customFields: {},
                    channels: [channel, { id: 'channel-2', code: 'store-two' }],
                } as unknown as PaymentMethod,
            ]),
            save: vi.fn((value: PaymentMethod) => value),
        };
        const removeFromChannels = vi.fn().mockResolvedValue(undefined);
        const paymentMethodService = {
            create: vi.fn().mockResolvedValue({ id: 'isolated-usdt-payment-method' }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === StoreUsdtWallet) return walletRepository;
                if (entity === StoreUsdtWalletAudit) return auditRepository;
                if (entity === Channel) return channelRepository;
                throw new Error(`Unexpected entity ${String(entity)}`);
            }),
            getEntityOrThrow: vi.fn(() => channel),
            rawConnection: {
                getRepository: vi.fn(entity => {
                    if (entity === PaymentMethod) return paymentMethodRepository;
                    throw new Error(`Unexpected raw entity ${String(entity)}`);
                }),
            },
        };
        const service = new StoreUsdtWalletService(
            connection as any,
            new UsdtWalletConfigurationService(),
            {
                getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
                removeFromChannels,
            } as any,
            paymentMethodService as any,
            { create: vi.fn().mockResolvedValue({ channelId: channel.id }) } as any,
        );

        const submitted = await service.submit(
            { channelId: channel.id, activeUserId: 'merchant-user' } as any,
            USDT_TRC20_CONTRACT_ADDRESS,
        );

        expect(submitted).toMatchObject({ reviewStatus: 'PENDING', configured: false, canReview: false });
        const submittedEntity = walletRepository.save.mock.calls.at(-1)?.[0];
        expect(submittedEntity?.pendingReceivingAddressEncrypted).toMatch(/^v2:/u);
        expect(submittedEntity?.pendingReceivingAddressEncrypted).not.toContain(USDT_TRC20_CONTRACT_ADDRESS);
        await expect(service.requireConfigured({ channelId: channel.id } as any)).rejects.toThrow(
            '尚未通过平台审核',
        );
        await expect(
            service.review({ activeUserId: 'merchant-user' } as any, {
                channelId: channel.id,
                approved: true,
            }),
        ).rejects.toThrow('提交人不能审核自己提交的 USDT 收款地址');
        await expect(
            service.review({ activeUserId: 'merchant-user' } as any, {
                channelId: channel.id,
                approved: false,
                rejectionReason: 'self review is forbidden',
            }),
        ).rejects.toThrow('提交人不能审核自己提交的 USDT 收款地址');
        expect(submittedEntity?.reviewStatus).toBe('PENDING');
        expect(audits.map(audit => audit.action)).toEqual(['SUBMITTED']);
        expect(paymentMethodService.create).not.toHaveBeenCalled();

        const approved = await service.review({ activeUserId: 'superadmin-user' } as any, {
            channelId: channel.id,
            approved: true,
        });
        const configuration = await service.requireConfigured({ channelId: channel.id } as any);

        expect(approved).toMatchObject({ reviewStatus: 'ACTIVE', configured: true, canReview: false });
        expect(configuration.receivingAddress).toBe(USDT_TRC20_CONTRACT_ADDRESS);
        expect(paymentMethodService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: channel.id }),
            expect.objectContaining({
                code: 'usdt-trc20',
                handler: { code: 'usdt-trc20-chain-handler', arguments: [] },
            }),
        );
        expect(removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            PaymentMethod,
            'isolated-usdt-payment-method',
            ['default-channel'],
        );
        expect(removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            PaymentMethod,
            'usdt-payment-method',
            [channel.id],
        );
        expect(audits.map(audit => audit.action)).toEqual(['SUBMITTED', 'APPROVED']);
        expect(JSON.stringify(audits)).not.toContain(USDT_TRC20_CONTRACT_ADDRESS);
    });

    it('keeps the active wallet available when a replacement address is rejected', async () => {
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', 'unit-test-wallet-encryption-key-that-is-long-enough');
        const encryption = new UsdtWalletConfigurationService();
        const channel = { id: 'channel-1', code: 'store-one' } as Channel;
        let stored = Object.assign(
            new StoreUsdtWallet({
                id: 'wallet-1',
                channelId: channel.id,
                channel,
                reviewStatus: 'ACTIVE',
                activeReceivingAddressEncrypted:
                    encryption.encryptReceivingAddress(USDT_TRC20_CONTRACT_ADDRESS),
                activeReceivingAddressFingerprint: fingerprintReceivingAddress(USDT_TRC20_CONTRACT_ADDRESS),
                pendingReceivingAddressEncrypted: null,
                pendingReceivingAddressFingerprint: null,
            }),
            { channel },
        );
        const walletRepository = {
            findOne: vi.fn(() => stored),
            save: vi.fn((wallet: StoreUsdtWallet) => (stored = wallet)),
            createQueryBuilder: vi.fn(() => lockedQuery(() => stored)),
        };
        const auditRepository = { save: vi.fn((value: unknown) => value) };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StoreUsdtWallet ? walletRepository : auditRepository,
            ),
            getEntityOrThrow: vi.fn(() => channel),
            rawConnection: { getRepository: vi.fn() },
        };
        const service = new StoreUsdtWalletService(
            connection as any,
            encryption,
            {} as any,
            {} as any,
            {} as any,
        );

        await service.submit(
            { channelId: channel.id, activeUserId: 'merchant-user' } as any,
            replacementAddress,
        );
        const rejected = await service.review({ activeUserId: 'superadmin-user' } as any, {
            channelId: channel.id,
            approved: false,
            rejectionReason: '地址归属凭证不完整',
        });

        expect(rejected).toMatchObject({
            reviewStatus: 'ACTIVE',
            configured: true,
            rejectionReason: '地址归属凭证不完整',
            pendingReceivingAddress: null,
        });
        await expect(service.requireConfigured({ channelId: channel.id } as any)).resolves.toMatchObject({
            receivingAddress: USDT_TRC20_CONTRACT_ADDRESS,
        });
    });

    it('transactionally re-encrypts old wallet ciphertext before a previous key is removed', async () => {
        const previousKey = 'previous-production-wallet-key-that-is-long-enough';
        const currentKey = 'current-production-wallet-key-that-is-long-enough';
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', previousKey);
        const oldCiphertext = new UsdtWalletConfigurationService().encryptReceivingAddress(
            USDT_TRC20_CONTRACT_ADDRESS,
        );
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', currentKey);
        vi.stubEnv('USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS', previousKey);
        const encryption = new UsdtWalletConfigurationService();
        const wallet = new StoreUsdtWallet({
            id: 'wallet-1',
            channelId: 'channel-1',
            reviewStatus: 'ACTIVE',
            activeReceivingAddressEncrypted: oldCiphertext,
            activeReceivingAddressFingerprint: fingerprintReceivingAddress(USDT_TRC20_CONTRACT_ADDRESS),
            pendingReceivingAddressEncrypted: null,
            pendingReceivingAddressFingerprint: null,
        });
        const walletRepository = {
            find: vi.fn(() => [wallet]),
            save: vi.fn((value: unknown) => value),
        };
        const auditRepository = { save: vi.fn((value: unknown) => value) };
        const connection = {
            withTransaction: vi.fn((_ctx, work) => work({ channelId: 'channel-1' })),
            getRepository: vi.fn((_ctx, entity) =>
                entity === StoreUsdtWallet ? walletRepository : auditRepository,
            ),
        };
        const service = new StoreUsdtWalletService(
            connection as any,
            encryption,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(service.rotateEncryptionKey({} as any)).resolves.toBe(1);

        expect(wallet.activeReceivingAddressEncrypted).not.toBe(oldCiphertext);
        expect(wallet.activeReceivingAddressEncrypted).toMatch(/^v2:/u);
        expect(auditRepository.save).toHaveBeenCalledWith(
            [expect.objectContaining({ action: 'REENCRYPTED' })],
            { reload: false },
        );
        vi.stubEnv('USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS', '');
        const reencryptedAddress = wallet.activeReceivingAddressEncrypted;
        if (!reencryptedAddress) throw new Error('Expected the active wallet address to be re-encrypted');
        expect(encryption.decryptReceivingAddress(reencryptedAddress)).toBe(USDT_TRC20_CONTRACT_ADDRESS);
    });
});

function lockedQuery(value: () => StoreUsdtWallet | null) {
    const query = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn(() => value()),
    };
    return query;
}

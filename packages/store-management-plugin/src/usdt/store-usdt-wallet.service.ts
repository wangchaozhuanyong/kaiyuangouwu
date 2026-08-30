import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Channel,
    ChannelService,
    PaymentMethod,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { StoreUsdtWallet } from '../entities/store-usdt-wallet.entity';

import {
    USDT_TRC20_CONTRACT_ADDRESS,
    USDT_TRC20_NETWORK,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt-payment.constants';
import {
    ConfiguredUsdtWalletConfiguration,
    fingerprintReceivingAddress,
    isValidTronMainnetAddress,
    UsdtWalletConfiguration,
    UsdtWalletConfigurationService,
} from './usdt-wallet-configuration.service';

export interface StoreUsdtWalletView {
    channelId: ID;
    channelCode: string;
    reviewStatus: string;
    configured: boolean;
    network: string;
    activeReceivingAddressMasked: string | null;
    activeReceivingAddressFingerprint: string | null;
    pendingReceivingAddress: string | null;
    pendingReceivingAddressFingerprint: string | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    rejectionReason: string | null;
}

export interface ReviewStoreUsdtWalletInput {
    channelId: ID;
    approved: boolean;
    rejectionReason?: string | null;
}

@Injectable()
export class StoreUsdtWalletService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly encryption: UsdtWalletConfigurationService,
        private readonly channelService: ChannelService,
    ) {}

    async configurationForChannel(
        ctx: RequestContext,
        channelId: ID = ctx.channelId,
    ): Promise<UsdtWalletConfiguration> {
        const wallet = await this.connection.getRepository(ctx, StoreUsdtWallet).findOne({
            where: { channelId },
        });
        if (!wallet?.activeReceivingAddressEncrypted || !wallet.activeReceivingAddressFingerprint) {
            return unconfiguredWallet();
        }
        const receivingAddress = this.encryption.decryptReceivingAddress(
            wallet.activeReceivingAddressEncrypted,
        );
        if (
            !isValidTronMainnetAddress(receivingAddress) ||
            fingerprintReceivingAddress(receivingAddress) !== wallet.activeReceivingAddressFingerprint
        ) {
            throw new Error(`Channel ${String(channelId)} USDT wallet failed integrity validation`);
        }
        return {
            enabled: true,
            network: USDT_TRC20_NETWORK,
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            receivingAddress,
            receivingAddressFingerprint: wallet.activeReceivingAddressFingerprint,
        };
    }

    async requireConfigured(
        ctx: RequestContext,
        channelId: ID = ctx.channelId,
    ): Promise<ConfiguredUsdtWalletConfiguration> {
        const configuration = await this.configurationForChannel(ctx, channelId);
        if (
            !configuration.enabled ||
            !configuration.receivingAddress ||
            !configuration.receivingAddressFingerprint
        ) {
            throw new Error('USDT-TRC20 收款地址尚未通过平台审核');
        }
        return configuration as ConfiguredUsdtWalletConfiguration;
    }

    async status(ctx: RequestContext, channelId: ID = ctx.channelId): Promise<StoreUsdtWalletView> {
        const repository = this.connection.getRepository(ctx, StoreUsdtWallet);
        const wallet = await repository.findOne({ where: { channelId }, relations: { channel: true } });
        const channel = wallet?.channel ?? (await this.connection.getEntityOrThrow(ctx, Channel, channelId));
        return this.toView(wallet, channel);
    }

    async list(ctx: RequestContext): Promise<StoreUsdtWalletView[]> {
        const channels = await this.connection.getRepository(ctx, Channel).find({ order: { code: 'ASC' } });
        const wallets = await this.connection.getRepository(ctx, StoreUsdtWallet).find({
            relations: { channel: true },
        });
        const byChannelId = new Map(wallets.map(wallet => [String(wallet.channelId), wallet]));
        return channels.map(channel => this.toView(byChannelId.get(String(channel.id)) ?? null, channel));
    }

    async submit(ctx: RequestContext, receivingAddressInput: string): Promise<StoreUsdtWalletView> {
        const receivingAddress = receivingAddressInput.trim();
        if (!isValidTronMainnetAddress(receivingAddress)) {
            throw new UserInputError('请输入有效的 TRON 主网收款地址');
        }
        if (!this.encryption.hasEncryptionKey()) {
            throw new UserInputError('服务器尚未配置 USDT 钱包加密密钥');
        }
        const repository = this.connection.getRepository(ctx, StoreUsdtWallet);
        const channel = await this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId);
        let wallet = await repository.findOne({ where: { channelId: ctx.channelId } });
        wallet ??= new StoreUsdtWallet({
            channelId: ctx.channelId,
            reviewStatus: 'UNCONFIGURED',
            activeReceivingAddressEncrypted: null,
            activeReceivingAddressFingerprint: null,
        });
        wallet.pendingReceivingAddressEncrypted = this.encryption.encryptReceivingAddress(receivingAddress);
        wallet.pendingReceivingAddressFingerprint = fingerprintReceivingAddress(receivingAddress);
        wallet.reviewStatus = 'PENDING';
        wallet.submittedAt = new Date();
        wallet.submittedByUserId = ctx.activeUserId ?? null;
        wallet.reviewedAt = null;
        wallet.reviewedByUserId = null;
        wallet.rejectionReason = null;
        return this.toView(await repository.save(wallet), channel);
    }

    async review(ctx: RequestContext, input: ReviewStoreUsdtWalletInput): Promise<StoreUsdtWalletView> {
        const repository = this.connection.getRepository(ctx, StoreUsdtWallet);
        const wallet = await repository.findOne({
            where: { channelId: input.channelId },
            relations: { channel: true },
        });
        if (!wallet?.pendingReceivingAddressEncrypted || !wallet.pendingReceivingAddressFingerprint) {
            throw new UserInputError('该网店没有待审核的 USDT 收款地址');
        }
        if (input.approved) {
            const pendingAddress = this.encryption.decryptReceivingAddress(
                wallet.pendingReceivingAddressEncrypted,
            );
            if (
                !isValidTronMainnetAddress(pendingAddress) ||
                fingerprintReceivingAddress(pendingAddress) !== wallet.pendingReceivingAddressFingerprint
            ) {
                throw new UserInputError('待审核收款地址未通过完整性校验');
            }
            wallet.activeReceivingAddressEncrypted = wallet.pendingReceivingAddressEncrypted;
            wallet.activeReceivingAddressFingerprint = wallet.pendingReceivingAddressFingerprint;
            wallet.reviewStatus = 'ACTIVE';
            wallet.rejectionReason = null;
        } else {
            const reason = input.rejectionReason?.trim() ?? '';
            if (!reason) throw new UserInputError('驳回时请填写原因');
            if (reason.length > 500) throw new UserInputError('驳回原因不能超过 500 个字符');
            wallet.reviewStatus = 'REJECTED';
            wallet.rejectionReason = reason;
        }
        wallet.pendingReceivingAddressEncrypted = null;
        wallet.pendingReceivingAddressFingerprint = null;
        wallet.reviewedAt = new Date();
        wallet.reviewedByUserId = ctx.activeUserId ?? null;
        const saved = await repository.save(wallet);
        if (input.approved) await this.assignPaymentMethodToChannel(ctx, wallet.channelId);
        return this.toView(saved, wallet.channel);
    }

    async seedLegacyWallet(
        ctx: RequestContext,
        channels: Channel[],
        legacy: UsdtWalletConfiguration,
    ): Promise<void> {
        if (
            !legacy.enabled ||
            !legacy.receivingAddress ||
            !legacy.receivingAddressFingerprint ||
            !channels.length
        ) {
            return;
        }
        const repository = this.connection.getRepository(ctx, StoreUsdtWallet);
        const existing = await repository.find();
        const existingChannelIds = new Set(existing.map(wallet => String(wallet.channelId)));
        const encrypted = this.encryption.encryptReceivingAddress(legacy.receivingAddress);
        const created = channels
            .filter(channel => !existingChannelIds.has(String(channel.id)))
            .map(
                channel =>
                    new StoreUsdtWallet({
                        channelId: channel.id,
                        reviewStatus: 'ACTIVE',
                        activeReceivingAddressEncrypted: encrypted,
                        activeReceivingAddressFingerprint: legacy.receivingAddressFingerprint,
                        pendingReceivingAddressEncrypted: null,
                        pendingReceivingAddressFingerprint: null,
                        submittedAt: null,
                        submittedByUserId: null,
                        reviewedAt: new Date(),
                        reviewedByUserId: null,
                        rejectionReason: null,
                    }),
            );
        if (created.length) await repository.save(created, { reload: false });
    }

    private toView(wallet: StoreUsdtWallet | null, channel: Channel): StoreUsdtWalletView {
        const activeAddress = wallet?.activeReceivingAddressEncrypted
            ? this.encryption.decryptReceivingAddress(wallet.activeReceivingAddressEncrypted)
            : null;
        const pendingAddress = wallet?.pendingReceivingAddressEncrypted
            ? this.encryption.decryptReceivingAddress(wallet.pendingReceivingAddressEncrypted)
            : null;
        return {
            channelId: channel.id,
            channelCode: channel.code,
            reviewStatus: wallet?.reviewStatus ?? 'UNCONFIGURED',
            configured: Boolean(activeAddress && wallet?.activeReceivingAddressFingerprint),
            network: USDT_TRC20_NETWORK,
            activeReceivingAddressMasked: activeAddress ? maskTronAddress(activeAddress) : null,
            activeReceivingAddressFingerprint: wallet?.activeReceivingAddressFingerprint ?? null,
            pendingReceivingAddress: pendingAddress,
            pendingReceivingAddressFingerprint: wallet?.pendingReceivingAddressFingerprint ?? null,
            submittedAt: wallet?.submittedAt ?? null,
            reviewedAt: wallet?.reviewedAt ?? null,
            rejectionReason: wallet?.rejectionReason ?? null,
        };
    }

    private async assignPaymentMethodToChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: { code: USDT_TRC20_PAYMENT_METHOD_CODE },
        });
        if (!paymentMethod) throw new Error('USDT payment method is missing');
        await this.channelService.assignToChannels(ctx, PaymentMethod, paymentMethod.id, [channelId]);
    }
}

function unconfiguredWallet(): UsdtWalletConfiguration {
    return {
        enabled: false,
        network: USDT_TRC20_NETWORK,
        tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
        receivingAddress: null,
        receivingAddressFingerprint: null,
    };
}

export function maskTronAddress(address: string): string {
    return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

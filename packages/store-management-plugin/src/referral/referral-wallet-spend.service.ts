import { Injectable } from '@nestjs/common';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { Customer, ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

import { ReferralAccount } from '../entities/referral-account.entity';
import { ReferralLedgerEntry } from '../entities/referral-ledger-entry.entity';
import { ReferralProgramConfig } from '../entities/referral-program-config.entity';
import { ReferralWalletUsage } from '../entities/referral-wallet-usage.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';

export interface ReserveReferralWalletInput {
    customerId: ID;
    currencyCode: CurrencyCode;
    amount: number;
    resourceType: string;
    resourceId: string;
    idempotencyKey: string;
    actorId?: ID | null;
    actorType?: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
    metadata?: Record<string, any> | null;
}

export interface SettleReferralWalletInput {
    usageId: ID;
    amount: number;
    operationKey: string;
    actorId?: ID | null;
    actorType?: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
    metadata?: Record<string, any> | null;
}

export type ReferralWalletSettlementAction = 'CAPTURE' | 'RELEASE' | 'REFUND';

export function calculateReferralWalletSettlement(
    usage: { amount: number; capturedAmount: number; releasedAmount: number },
    wallet: { availableBalance: number; reservedBalance: number },
    action: ReferralWalletSettlementAction,
    amount: number,
) {
    const remaining = usage.amount - usage.capturedAmount - usage.releasedAmount;
    if (action === 'REFUND' ? amount > usage.capturedAmount : amount > remaining) {
        throw new UserInputError(action === 'REFUND' ? '退款金额超过已结算金额' : '结算金额超过剩余预占金额');
    }
    if (action !== 'REFUND' && wallet.reservedBalance < amount)
        throw new UserInputError('返利账户预占余额异常');

    const capturedAmount =
        usage.capturedAmount + (action === 'CAPTURE' ? amount : action === 'REFUND' ? -amount : 0);
    const releasedAmount = usage.releasedAmount + (action === 'CAPTURE' ? 0 : amount);
    const availableBalance = wallet.availableBalance + (action === 'CAPTURE' ? 0 : amount);
    const reservedBalance = wallet.reservedBalance - (action === 'REFUND' ? 0 : amount);
    const settled = capturedAmount + releasedAmount === usage.amount;
    return {
        capturedAmount,
        releasedAmount,
        availableBalance,
        reservedBalance,
        status: settled
            ? capturedAmount === usage.amount
                ? 'CAPTURED'
                : releasedAmount === usage.amount
                  ? 'RELEASED'
                  : 'PARTIAL'
            : 'RESERVED',
        settled,
        eventType:
            action === 'CAPTURE'
                ? 'WALLET_USAGE_CAPTURED'
                : action === 'REFUND'
                  ? 'WALLET_USAGE_REFUNDED'
                  : 'WALLET_USAGE_RELEASED',
        availableDelta: action === 'CAPTURE' ? 0 : amount,
        reservedDelta: action === 'REFUND' ? 0 : -amount,
    };
}

@Injectable()
export class ReferralWalletSpendService {
    constructor(private readonly connection: TransactionalConnection) {}

    reserve(ctx: RequestContext, input: ReserveReferralWalletInput): Promise<ReferralWalletUsage> {
        this.validateMoney(input.amount);
        input = {
            ...input,
            idempotencyKey: normalizedToken(input.idempotencyKey, 255, '幂等键'),
            resourceType: normalizedToken(input.resourceType, 48, '资源类型'),
            resourceId: normalizedToken(input.resourceId, 128, '资源编号'),
        };
        return this.connection.withTransaction(ctx, async txCtx => {
            const usageRepository = this.connection.getRepository(txCtx, ReferralWalletUsage);
            const duplicate = await usageRepository.findOne({
                where: { idempotencyKey: input.idempotencyKey },
            });
            if (duplicate) return this.assertSameReservation(txCtx, duplicate, input);

            const config = await this.connection.getRepository(txCtx, ReferralProgramConfig).findOne({
                where: { channelId: txCtx.channelId },
            });
            if (config && !config.allowBalanceSpend) {
                throw new UserInputError('当前店铺已暂停使用返利余额');
            }
            const customer = await this.connection.getRepository(txCtx, Customer).findOne({
                where: { id: input.customerId },
            });
            if (!customer) throw new UserInputError('找不到当前客户');
            const account = await this.getOrCreateAccount(txCtx, customer);
            const wallet = await this.getOrCreateWallet(txCtx, account, customer, input.currencyCode);
            await this.lockRow(txCtx, ReferralWallet, wallet.id);

            const raced = await usageRepository.findOne({
                where: { idempotencyKey: input.idempotencyKey },
                // The wallet lock may have waited for another reservation to commit. A locking
                // read must see that receipt even under MySQL's REPEATABLE READ isolation.
                ...this.currentReadLock(),
            });
            if (raced) return this.assertSameReservation(txCtx, raced, input);
            const freshWallet = await this.connection
                .getRepository(txCtx, ReferralWallet)
                .findOneOrFail({ where: { id: wallet.id }, ...this.currentReadLock() });
            if (freshWallet.availableBalance < input.amount) throw new UserInputError('返利可用余额不足');

            const usage = await usageRepository.save(
                new ReferralWalletUsage({
                    channelId: txCtx.channelId,
                    walletId: freshWallet.id,
                    customerId: customer.id,
                    currencyCode: input.currencyCode,
                    resourceType: normalizedToken(input.resourceType, 48, '资源类型'),
                    resourceId: normalizedToken(input.resourceId, 128, '资源编号'),
                    idempotencyKey: normalizedToken(input.idempotencyKey, 255, '幂等键'),
                    amount: input.amount,
                    capturedAmount: 0,
                    releasedAmount: 0,
                    status: 'RESERVED',
                    reservedAt: new Date(),
                    settledAt: null,
                    metadata: input.metadata ?? null,
                }),
            );
            freshWallet.availableBalance -= input.amount;
            freshWallet.reservedBalance += input.amount;
            await this.connection.getRepository(txCtx, ReferralWallet).save(freshWallet, { reload: false });
            await this.writeLedger(txCtx, freshWallet, {
                eventType: 'WALLET_USAGE_RESERVED',
                idempotencyKey: `WALLET_USAGE_RESERVED:${usage.id}`,
                availableDelta: -input.amount,
                reservedDelta: input.amount,
                actorId: input.actorId,
                actorType: input.actorType,
                metadata: {
                    usageId: String(usage.id),
                    resourceType: usage.resourceType,
                    resourceId: usage.resourceId,
                },
            });
            return usage;
        });
    }

    capture(ctx: RequestContext, input: SettleReferralWalletInput): Promise<ReferralWalletUsage> {
        return this.settle(ctx, input, 'CAPTURE');
    }

    release(ctx: RequestContext, input: SettleReferralWalletInput): Promise<ReferralWalletUsage> {
        return this.settle(ctx, input, 'RELEASE');
    }

    refundCaptured(ctx: RequestContext, input: SettleReferralWalletInput): Promise<ReferralWalletUsage> {
        return this.settle(ctx, input, 'REFUND');
    }

    private settle(
        ctx: RequestContext,
        input: SettleReferralWalletInput,
        action: ReferralWalletSettlementAction,
    ): Promise<ReferralWalletUsage> {
        this.validateMoney(input.amount);
        const eventType =
            action === 'CAPTURE'
                ? 'WALLET_USAGE_CAPTURED'
                : action === 'REFUND'
                  ? 'WALLET_USAGE_REFUNDED'
                  : 'WALLET_USAGE_RELEASED';
        const operationKey = normalizedToken(input.operationKey, 96, '操作键');
        const ledgerIdempotencyKey = `${eventType}:${String(input.usageId)}:${operationKey}`;
        return this.connection.withTransaction(ctx, async txCtx => {
            const ledgerRepository = this.connection.getRepository(txCtx, ReferralLedgerEntry);
            const usageRepository = this.connection.getRepository(txCtx, ReferralWalletUsage);
            // All settlement paths first resolve and lock the same store-owned usage. Replays
            // cannot bypass ownership, and concurrent calls read the committed receipt below.
            const usage = await usageRepository.findOne({
                where: { id: input.usageId, channelId: txCtx.channelId },
                ...this.currentReadLock(),
            });
            if (!usage) throw new UserInputError('找不到余额预占记录');
            const wallet = await this.connection
                .getRepository(txCtx, ReferralWallet)
                .findOneOrFail({ where: { id: usage.walletId }, ...this.currentReadLock() });
            this.assertUsageWallet(ctx, usage, wallet);
            const duplicate = await ledgerRepository.findOne({
                where: { idempotencyKey: ledgerIdempotencyKey },
                ...this.currentReadLock(),
            });
            if (duplicate) {
                this.assertSameSettlement(usage, duplicate, input, action, operationKey);
                return usage;
            }
            const settlement = calculateReferralWalletSettlement(usage, wallet, action, input.amount);
            usage.capturedAmount = settlement.capturedAmount;
            usage.releasedAmount = settlement.releasedAmount;
            usage.status = settlement.status;
            usage.settledAt = settlement.settled ? new Date() : null;
            wallet.availableBalance = settlement.availableBalance;
            wallet.reservedBalance = settlement.reservedBalance;
            await this.connection.getRepository(txCtx, ReferralWallet).save(wallet, { reload: false });
            await usageRepository.save(usage, { reload: false });
            await this.writeLedger(txCtx, wallet, {
                eventType,
                idempotencyKey: ledgerIdempotencyKey,
                availableDelta: settlement.availableDelta,
                reservedDelta: settlement.reservedDelta,
                actorId: input.actorId,
                actorType: input.actorType,
                metadata: {
                    ...input.metadata,
                    usageId: String(usage.id),
                    operationKey,
                    amount: input.amount,
                },
            });
            return usage;
        });
    }

    private assertSameSettlement(
        usage: ReferralWalletUsage,
        ledger: ReferralLedgerEntry,
        input: SettleReferralWalletInput,
        action: ReferralWalletSettlementAction,
        operationKey: string,
    ): void {
        const expectedAvailableDelta = action === 'CAPTURE' ? 0 : input.amount;
        const expectedReservedDelta = action === 'REFUND' ? 0 : -input.amount;
        const metadata = ledger.metadata ?? {};
        if (
            String(ledger.channelId) !== String(usage.channelId) ||
            String(ledger.walletId) !== String(usage.walletId) ||
            String(ledger.customerId) !== String(usage.customerId) ||
            ledger.currencyCode !== usage.currencyCode ||
            metadata.usageId !== String(usage.id) ||
            typeof metadata.operationKey !== 'string' ||
            metadata.operationKey.trim() !== operationKey ||
            ledger.eventType !==
                (action === 'CAPTURE'
                    ? 'WALLET_USAGE_CAPTURED'
                    : action === 'REFUND'
                      ? 'WALLET_USAGE_REFUNDED'
                      : 'WALLET_USAGE_RELEASED') ||
            ledger.availableDelta !== expectedAvailableDelta ||
            ledger.reservedDelta !== expectedReservedDelta
        ) {
            throw new UserInputError('幂等操作与原始余额结算请求不一致');
        }
    }

    private assertUsageWallet(ctx: RequestContext, usage: ReferralWalletUsage, wallet: ReferralWallet): void {
        if (
            String(usage.channelId) !== String(ctx.channelId) ||
            String(wallet.channelId) !== String(usage.channelId) ||
            String(wallet.customerId) !== String(usage.customerId) ||
            wallet.currencyCode !== usage.currencyCode
        ) {
            throw new UserInputError('余额预占记录与账户归属不一致');
        }
    }

    private currentReadLock(): { lock?: { mode: 'pessimistic_write' } } {
        return supportsWalletLock(this.connection.rawConnection.options.type)
            ? { lock: { mode: 'pessimistic_write' } }
            : {};
    }

    private async writeLedger(
        ctx: RequestContext,
        wallet: ReferralWallet,
        input: {
            eventType: string;
            idempotencyKey: string;
            availableDelta: number;
            reservedDelta: number;
            actorId?: ID | null;
            actorType?: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
            metadata?: Record<string, any> | null;
        },
    ): Promise<void> {
        await this.connection.getRepository(ctx, ReferralLedgerEntry).save(
            new ReferralLedgerEntry({
                channelId: ctx.channelId,
                walletId: wallet.id,
                customerId: wallet.customerId,
                currencyCode: wallet.currencyCode,
                eventType: input.eventType,
                availableDelta: input.availableDelta,
                pendingDelta: 0,
                reservedDelta: input.reservedDelta,
                availableAfter: wallet.availableBalance,
                pendingAfter: wallet.pendingBalance,
                reservedAfter: wallet.reservedBalance,
                idempotencyKey: input.idempotencyKey,
                orderId: null,
                refundId: null,
                withdrawalId: null,
                actorId: input.actorId ?? null,
                actorType: input.actorType ?? (input.actorId ? 'CUSTOMER' : 'SYSTEM'),
                note: input.eventType,
                metadata: input.metadata ?? null,
            }),
            { reload: false },
        );
    }

    private async getOrCreateAccount(ctx: RequestContext, customer: Customer): Promise<ReferralAccount> {
        const repository = this.connection.getRepository(ctx, ReferralAccount);
        const existing = await repository.findOne({
            where: { channelId: ctx.channelId, customerId: customer.id },
        });
        if (existing) return existing;
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                return await repository.save(
                    new ReferralAccount({
                        channelId: ctx.channelId,
                        customerId: customer.id,
                        inviteCode: randomBytes(6).toString('base64url').toUpperCase().slice(0, 10),
                    }),
                );
            } catch (error) {
                const raced = await repository.findOne({
                    where: { channelId: ctx.channelId, customerId: customer.id },
                });
                if (raced) return raced;
                if (attempt === 11) throw error;
            }
        }
        throw new UserInputError('创建返利账户失败');
    }

    private async getOrCreateWallet(
        ctx: RequestContext,
        account: ReferralAccount,
        customer: Customer,
        currencyCode: CurrencyCode,
    ): Promise<ReferralWallet> {
        const repository = this.connection.getRepository(ctx, ReferralWallet);
        const existing = await repository.findOne({ where: { referralAccountId: account.id, currencyCode } });
        if (existing) return existing;
        try {
            return await repository.save(
                new ReferralWallet({
                    channelId: ctx.channelId,
                    referralAccountId: account.id,
                    customerId: customer.id,
                    currencyCode,
                    availableBalance: 0,
                    pendingBalance: 0,
                    reservedBalance: 0,
                }),
            );
        } catch (error) {
            const raced = await repository.findOne({
                where: { referralAccountId: account.id, currencyCode },
            });
            if (raced) return raced;
            throw error;
        }
    }

    private assertSameReservation(
        ctx: RequestContext,
        usage: ReferralWalletUsage,
        input: ReserveReferralWalletInput,
    ): ReferralWalletUsage {
        if (
            String(usage.channelId) !== String(ctx.channelId) ||
            String(usage.customerId) !== String(input.customerId) ||
            usage.resourceType !== input.resourceType ||
            usage.resourceId !== input.resourceId ||
            usage.amount !== input.amount ||
            usage.currencyCode !== input.currencyCode
        ) {
            throw new UserInputError('幂等键已被其他请求使用');
        }
        return usage;
    }

    private validateMoney(amount: number): void {
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserInputError('金额必须是正整数');
    }

    private async lockRow<T extends { id: ID }>(
        ctx: RequestContext,
        entity: new (...args: never[]) => T,
        id: ID,
    ): Promise<void> {
        if (!supportsWalletLock(this.connection.rawConnection.options.type)) return;
        try {
            await this.connection
                .getRepository(ctx, entity)
                .createQueryBuilder('lockedRow')
                .setLock('pessimistic_write')
                .where('lockedRow.id = :id', { id })
                .getOne();
        } catch (error) {
            if (
                !(error instanceof LockNotSupportedOnGivenDriverError) &&
                (error as { name?: string } | null)?.name !== 'LockNotSupportedOnGivenDriverError'
            ) {
                throw error;
            }
        }
    }
}

function normalizedToken(value: string, maxLength: number, label: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/u.test(normalized)) {
        throw new UserInputError(`${label}无效`);
    }
    return normalized;
}

function supportsWalletLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'cockroachdb',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}

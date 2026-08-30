import { Injectable } from '@nestjs/common';
import {
    Channel,
    isGraphQlErrorResult,
    OrderService,
    Payment,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createHash, randomInt } from 'node:crypto';
import { LessThan, MoreThan, QueryFailedError } from 'typeorm';

import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { maskTronAddress, StoreUsdtWalletService } from './store-usdt-wallet.service';
import { createUsdtPaymentProof } from './usdt-payment-proof';
import {
    USDT_PAYMENT_INTENT_STATUS,
    USDT_TRC20_CONTRACT_ADDRESS,
    USDT_TRC20_NETWORK,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt-payment.constants';
import { ConfirmedTrc20Transfer, UsdtTrc20Client } from './usdt-trc20-client';
import { fingerprintReceivingAddress, isValidTronMainnetAddress } from './usdt-wallet-configuration.service';

const PAYMENT_MATCH_GRACE_MS = 60 * 1000;
const FINALITY_DISCOVERY_GRACE_MS = 30 * 60 * 1000;
const UNIQUE_AMOUNT_VARIATIONS = 999;
const PAYMENT_PROOF_TTL_MS = 5 * 60 * 1000;

export interface UsdtPaymentScanResult {
    configured: boolean;
    pendingIntentCount: number;
    transferCount: number;
    settledCount: number;
    manualReviewCount: number;
    expiredCount: number;
}

export interface StoreUsdtPaymentIntentView {
    id: string;
    channelId: string;
    channelCode: string;
    orderId: string;
    orderCode: string;
    network: string;
    fiatCurrencyCode: string;
    fiatAmount: number;
    fiatPerUsdtRate: number;
    markupPercent: number;
    rateSource: string;
    receivingAddressMasked: string;
    receivingAddressFingerprint: string;
    baseUsdtAmount: number;
    expectedUsdtAmount: number;
    receivedUsdtAmount: number | null;
    senderAddressMasked: string | null;
    status: string;
    transactionId: string | null;
    failureReason: string | null;
    createdAt: Date;
    expiresAt: Date;
    settledAt: Date | null;
    blockNumber: number | null;
    blockTimestamp: Date | null;
    lastCheckedAt: Date | null;
}

export interface StoreUsdtChannelPaymentStats {
    channelId: string;
    channelCode: string;
    totalCount: number;
    pendingCount: number;
    settledCount: number;
    manualReviewCount: number;
    expiredCount: number;
    expectedUsdtTotal: number;
    receivedUsdtTotal: number;
    fiatTotals: Array<{ currencyCode: string; amount: number }>;
}

@Injectable()
export class UsdtPaymentService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly requestContextService: RequestContextService,
        private readonly storeWallets: StoreUsdtWalletService,
        private readonly tronClient: UsdtTrc20Client,
    ) {}

    async walletStatus(
        ctx: RequestContext,
        channelId = ctx.channelId,
    ): Promise<{
        configured: boolean;
        network: string;
        receivingAddressMasked: string | null;
        receivingAddressFingerprint: string | null;
        reviewStatus: string;
    }> {
        const wallet = await this.storeWallets.status(ctx, channelId);
        return {
            configured: wallet.configured,
            network: wallet.network,
            receivingAddressMasked: wallet.activeReceivingAddressMasked,
            receivingAddressFingerprint: wallet.activeReceivingAddressFingerprint,
            reviewStatus: wallet.reviewStatus,
        };
    }

    async listForChannel(ctx: RequestContext): Promise<StoreUsdtPaymentIntentView[]> {
        const intents = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).find({
            where: { channelId: ctx.channelId },
            relations: { order: true, channel: true, quote: true },
            order: { createdAt: 'DESC' },
            take: 100,
        });
        return intents.map(intent => this.toIntentView(intent));
    }

    async listForPlatform(
        ctx: RequestContext,
        channelId?: string | null,
    ): Promise<StoreUsdtPaymentIntentView[]> {
        const intents = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).find({
            ...(channelId ? { where: { channelId } } : {}),
            relations: { order: true, channel: true, quote: true },
            order: { createdAt: 'DESC' },
            take: 200,
        });
        return intents.map(intent => this.toIntentView(intent));
    }

    async stats(ctx: RequestContext, channelId?: string | null): Promise<StoreUsdtChannelPaymentStats[]> {
        const query = this.connection
            .getRepository(ctx, StorefrontUsdtPaymentIntent)
            .createQueryBuilder('intent')
            .innerJoin('intent.channel', 'channel')
            .innerJoin('intent.quote', 'quote')
            .select('intent.channelId', 'channelId')
            .addSelect('channel.code', 'channelCode')
            .addSelect('quote.fiatCurrencyCode', 'currencyCode')
            .addSelect('COUNT(intent.id)', 'totalCount')
            .addSelect('SUM(CASE WHEN intent.status = :pendingStatus THEN 1 ELSE 0 END)', 'pendingCount')
            .addSelect('SUM(CASE WHEN intent.status = :settledStatus THEN 1 ELSE 0 END)', 'settledCount')
            .addSelect(
                'SUM(CASE WHEN intent.status = :manualReviewStatus THEN 1 ELSE 0 END)',
                'manualReviewCount',
            )
            .addSelect('SUM(CASE WHEN intent.status = :expiredStatus THEN 1 ELSE 0 END)', 'expiredCount')
            .addSelect('COALESCE(SUM(intent.expectedUsdtAmount), 0)', 'expectedUsdtTotal')
            .addSelect(
                'COALESCE(SUM(CASE WHEN intent.status = :settledStatus THEN intent.receivedUsdtAmount ELSE 0 END), 0)',
                'receivedUsdtTotal',
            )
            .addSelect(
                'COALESCE(SUM(CASE WHEN intent.status = :settledStatus THEN quote.fiatAmount ELSE 0 END), 0)',
                'fiatAmountTotal',
            )
            .setParameters({
                pendingStatus: USDT_PAYMENT_INTENT_STATUS.pending,
                settledStatus: USDT_PAYMENT_INTENT_STATUS.settled,
                manualReviewStatus: USDT_PAYMENT_INTENT_STATUS.manualReview,
                expiredStatus: USDT_PAYMENT_INTENT_STATUS.expired,
            })
            .groupBy('intent.channelId')
            .addGroupBy('channel.code')
            .addGroupBy('quote.fiatCurrencyCode');
        if (channelId) query.andWhere('intent.channelId = :channelId', { channelId });
        const rows = await query.getRawMany<{
            channelId: string | number;
            channelCode: string;
            currencyCode: string;
            totalCount: string | number;
            pendingCount: string | number;
            settledCount: string | number;
            manualReviewCount: string | number;
            expiredCount: string | number;
            expectedUsdtTotal: string | number;
            receivedUsdtTotal: string | number;
            fiatAmountTotal: string | number;
        }>();
        const grouped = new Map<string, StoreUsdtChannelPaymentStats>();
        for (const row of rows) {
            const key = String(row.channelId);
            let summary = grouped.get(key);
            if (!summary) {
                summary = emptyChannelStats(key, row.channelCode);
                grouped.set(key, summary);
            }
            summary.totalCount += Number(row.totalCount);
            summary.pendingCount += Number(row.pendingCount);
            summary.settledCount += Number(row.settledCount);
            summary.manualReviewCount += Number(row.manualReviewCount);
            summary.expiredCount += Number(row.expiredCount);
            summary.expectedUsdtTotal += Number(row.expectedUsdtTotal);
            summary.receivedUsdtTotal += Number(row.receivedUsdtTotal);
            const fiatAmount = Number(row.fiatAmountTotal);
            if (fiatAmount) summary.fiatTotals.push({ currencyCode: row.currencyCode, amount: fiatAmount });
        }
        const channels = channelId
            ? await this.connection.getRepository(ctx, Channel).find({ where: { id: channelId } })
            : await this.connection.getRepository(ctx, Channel).find({ order: { code: 'ASC' } });
        for (const channel of channels) {
            const key = String(channel.id);
            if (!grouped.has(key)) grouped.set(key, emptyChannelStats(key, channel.code));
        }
        return Array.from(grouped.values())
            .map(summary => ({
                ...summary,
                expectedUsdtTotal: roundUsdt(summary.expectedUsdtTotal),
                receivedUsdtTotal: roundUsdt(summary.receivedUsdtTotal),
            }))
            .sort((left, right) => left.channelCode.localeCompare(right.channelCode));
    }

    async statsForChannel(ctx: RequestContext): Promise<StoreUsdtChannelPaymentStats> {
        const [summary] = await this.stats(ctx, String(ctx.channelId));
        return summary ?? emptyChannelStats(String(ctx.channelId), ctx.channel.code);
    }

    private toIntentView(intent: StorefrontUsdtPaymentIntent): StoreUsdtPaymentIntentView {
        return {
            id: String(intent.id),
            channelId: String(intent.channelId),
            channelCode: intent.channel.code,
            orderId: String(intent.orderId),
            orderCode: intent.order.code,
            network: intent.network,
            fiatCurrencyCode: intent.quote.fiatCurrencyCode,
            fiatAmount: intent.quote.fiatAmount,
            fiatPerUsdtRate: intent.quote.fiatPerUsdtRate,
            markupPercent: intent.quote.markupBps / 100,
            rateSource: intent.quote.source,
            receivingAddressMasked: maskTronAddress(intent.receivingAddress),
            receivingAddressFingerprint: intent.receivingAddressFingerprint,
            baseUsdtAmount: Number(intent.baseUsdtAmount),
            expectedUsdtAmount: Number(intent.expectedUsdtAmount),
            receivedUsdtAmount: intent.receivedUsdtAmount ? Number(intent.receivedUsdtAmount) : null,
            senderAddressMasked: intent.senderAddress ? maskTronAddress(intent.senderAddress) : null,
            status: intent.status,
            transactionId: intent.transactionId,
            failureReason: intent.failureReason,
            createdAt: intent.createdAt,
            expiresAt: intent.expiresAt,
            settledAt: intent.settledAt,
            blockNumber: intent.blockNumber,
            blockTimestamp: intent.blockTimestamp,
            lastCheckedAt: intent.lastCheckedAt,
        };
    }

    async ensureIntent(
        ctx: RequestContext,
        quote: StorefrontUsdtCheckoutQuote,
    ): Promise<StorefrontUsdtPaymentIntent> {
        const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
        const existing = await repository.findOne({ where: { quoteId: quote.id } });
        if (existing) return existing;
        const wallet = await this.storeWallets.requireConfigured(ctx, quote.channelId);

        const baseAmount = normalizeUsdtAmount(quote.usdtAmount);
        const baseUnits = usdtAmountToBaseUnits(baseAmount);
        const firstVariation = randomInt(1, UNIQUE_AMOUNT_VARIATIONS + 1);
        for (let attempt = 0; attempt < UNIQUE_AMOUNT_VARIATIONS; attempt += 1) {
            const variation = ((firstVariation - 1 + attempt) % UNIQUE_AMOUNT_VARIATIONS) + 1;
            const expectedUsdtAmount = formatUsdtUnits(baseUnits + BigInt(variation));
            const matchKey = createMatchKey(
                wallet.network,
                wallet.receivingAddressFingerprint,
                expectedUsdtAmount,
            );
            try {
                return await repository.save(
                    new StorefrontUsdtPaymentIntent({
                        channelId: quote.channelId,
                        orderId: quote.orderId,
                        quoteId: quote.id,
                        paymentId: null,
                        network: wallet.network,
                        tokenContractAddress: wallet.tokenContractAddress,
                        receivingAddress: wallet.receivingAddress,
                        receivingAddressFingerprint: wallet.receivingAddressFingerprint,
                        matchKey,
                        baseUsdtAmount: baseAmount,
                        expectedUsdtAmount,
                        status: USDT_PAYMENT_INTENT_STATUS.pending,
                        transactionId: null,
                        senderAddress: null,
                        receivedUsdtAmount: null,
                        blockNumber: null,
                        blockTimestamp: null,
                        lastCheckedAt: null,
                        settledAt: null,
                        failureReason: null,
                        expiresAt: quote.expiresAt,
                    }),
                );
            } catch (error) {
                if (!isUniqueConstraintViolation(error)) throw error;
                const concurrent = await repository.findOne({ where: { quoteId: quote.id } });
                if (concurrent) return concurrent;
            }
        }
        throw new Error('当前 USDT 专属付款金额已用完，请稍后重新生成报价');
    }

    async scanPendingPayments(ctx: RequestContext, now = new Date()): Promise<UsdtPaymentScanResult> {
        const result: UsdtPaymentScanResult = {
            configured: false,
            pendingIntentCount: 0,
            transferCount: 0,
            settledCount: 0,
            manualReviewCount: 0,
            expiredCount: 0,
        };
        const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
        const expiryCutoff = new Date(now.getTime() - FINALITY_DISCOVERY_GRACE_MS);
        const stale = await repository.find({
            where: {
                status: USDT_PAYMENT_INTENT_STATUS.pending,
                expiresAt: LessThan(expiryCutoff),
            },
        });
        if (stale.length) {
            for (const intent of stale) intent.status = USDT_PAYMENT_INTENT_STATUS.expired;
            await repository.save(stale, { reload: false });
            result.expiredCount = stale.length;
        }

        const pending = await repository.find({
            where: {
                status: USDT_PAYMENT_INTENT_STATUS.pending,
                expiresAt: MoreThan(expiryCutoff),
            },
            relations: { channel: true, quote: true },
            order: { createdAt: 'ASC' },
        });
        result.pendingIntentCount = pending.length;
        result.configured = pending.length > 0;
        if (!pending.length) return result;

        const byReceivingAddress = new Map<string, StorefrontUsdtPaymentIntent[]>();
        for (const intent of pending) {
            const addressIntents = byReceivingAddress.get(intent.receivingAddress) ?? [];
            addressIntents.push(intent);
            byReceivingAddress.set(intent.receivingAddress, addressIntents);
        }
        for (const [receivingAddress, addressIntents] of byReceivingAddress) {
            const oldestCreatedAt = addressIntents.reduce(
                (oldest, intent) => (intent.createdAt < oldest ? intent.createdAt : oldest),
                addressIntents[0].createdAt,
            );
            const transfers = await this.tronClient.incomingTransfers(
                receivingAddress,
                new Date(oldestCreatedAt.getTime() - PAYMENT_MATCH_GRACE_MS),
            );
            result.transferCount += transfers.length;
            for (const intent of addressIntents) {
                intent.lastCheckedAt = now;
                const transfer = findMatchingTransfer(intent, transfers);
                if (!transfer) continue;
                const solidified = await this.tronClient.solidifiedTransaction(transfer.transactionId);
                if (!solidified) continue;
                const status = await this.settleMatchedIntent(intent, transfer, solidified.blockNumber, now);
                intent.status = status as StorefrontUsdtPaymentIntent['status'];
                if (status === USDT_PAYMENT_INTENT_STATUS.settled) result.settledCount += 1;
                if (status === USDT_PAYMENT_INTENT_STATUS.manualReview) result.manualReviewCount += 1;
            }
        }
        const stillPending = pending.filter(intent => intent.status === USDT_PAYMENT_INTENT_STATUS.pending);
        if (stillPending.length) await repository.save(stillPending, { reload: false });
        return result;
    }

    private async settleMatchedIntent(
        intent: StorefrontUsdtPaymentIntent,
        transfer: ConfirmedTrc20Transfer,
        blockNumber: number,
        now: Date,
    ): Promise<string> {
        const channelContext = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: intent.channel,
        });
        return this.connection.withTransaction(channelContext, async ctx => {
            const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
            const locked = await this.findLockedIntent(ctx, intent.id);
            if (!locked || locked.status !== USDT_PAYMENT_INTENT_STATUS.pending) {
                return locked?.status ?? USDT_PAYMENT_INTENT_STATUS.manualReview;
            }
            if (
                locked.network !== USDT_TRC20_NETWORK ||
                locked.tokenContractAddress !== USDT_TRC20_CONTRACT_ADDRESS ||
                !isValidTronMainnetAddress(locked.receivingAddress) ||
                locked.receivingAddressFingerprint !== fingerprintReceivingAddress(locked.receivingAddress)
            ) {
                locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                locked.failureReason = '订单绑定的收款钱包快照未通过完整性校验';
                await repository.save(locked, { reload: false });
                return locked.status;
            }

            locked.transactionId = transfer.transactionId;
            locked.senderAddress = transfer.from;
            locked.receivedUsdtAmount = transfer.amount;
            locked.blockNumber = blockNumber;
            locked.blockTimestamp = transfer.blockTimestamp;
            locked.lastCheckedAt = now;

            const quote = await this.connection.getEntityOrThrow(
                ctx,
                StorefrontUsdtCheckoutQuote,
                locked.quoteId,
            );
            const proof = createUsdtPaymentProof({
                channelId: String(locked.channelId),
                quoteId: String(locked.quoteId),
                orderId: String(locked.orderId),
                fiatCurrencyCode: quote.fiatCurrencyCode,
                fiatAmount: quote.fiatAmount,
                transactionId: transfer.transactionId,
                usdtAmount: locked.expectedUsdtAmount,
                receivingAddressFingerprint: locked.receivingAddressFingerprint,
                expiresAt: Date.now() + PAYMENT_PROOF_TTL_MS,
            });
            const paymentResult = await this.orderService.addPaymentToOrder(ctx, locked.orderId, {
                method: USDT_TRC20_PAYMENT_METHOD_CODE,
                metadata: { proof },
            });
            if (isGraphQlErrorResult(paymentResult)) {
                locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                locked.failureReason = paymentResult.message.slice(0, 500);
                await repository.save(locked, { reload: false });
                return locked.status;
            }

            const payment = await this.connection.getRepository(ctx, Payment).findOne({
                where: { transactionId: `tron:${transfer.transactionId}` },
            });
            if (!payment || payment.state !== 'Settled') {
                throw new Error('USDT payment was not persisted in the Settled state');
            }
            locked.paymentId = payment.id;
            locked.status = USDT_PAYMENT_INTENT_STATUS.settled;
            locked.settledAt = now;
            locked.failureReason = null;
            await repository.save(locked, { reload: false });
            return locked.status;
        });
    }

    private async findLockedIntent(
        ctx: RequestContext,
        intentId: StorefrontUsdtPaymentIntent['id'],
    ): Promise<StorefrontUsdtPaymentIntent | null> {
        try {
            return await this.connection
                .getRepository(ctx, StorefrontUsdtPaymentIntent)
                .createQueryBuilder('intent')
                .setLock('pessimistic_write')
                .where('intent.id = :intentId', { intentId })
                .getOne();
        } catch (error) {
            if (!isLockUnsupported(error)) throw error;
            return this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOne({
                where: { id: intentId },
            });
        }
    }
}

export function findMatchingTransfer(
    intent: Pick<
        StorefrontUsdtPaymentIntent,
        'expectedUsdtAmount' | 'receivingAddress' | 'createdAt' | 'expiresAt'
    >,
    transfers: ConfirmedTrc20Transfer[],
): ConfirmedTrc20Transfer | undefined {
    const earliest = intent.createdAt.getTime() - PAYMENT_MATCH_GRACE_MS;
    const latest = intent.expiresAt.getTime() + PAYMENT_MATCH_GRACE_MS;
    return transfers.find(
        transfer =>
            transfer.to === intent.receivingAddress &&
            transfer.amount === intent.expectedUsdtAmount &&
            transfer.blockTimestamp.getTime() >= earliest &&
            transfer.blockTimestamp.getTime() <= latest,
    );
}

export function createMatchKey(network: string, addressFingerprint: string, usdtAmount: string): string {
    return createHash('sha256')
        .update(`storefront-usdt-match:v1:${network}:${addressFingerprint}:${usdtAmount}`, 'utf8')
        .digest('hex');
}

export function normalizeUsdtAmount(value: string | number): string {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error('Invalid USDT amount');
    return number.toFixed(6);
}

function usdtAmountToBaseUnits(value: string): bigint {
    const [whole, fractional] = value.split('.');
    return BigInt(whole) * BigInt(1_000_000) + BigInt(fractional.padEnd(6, '0').slice(0, 6));
}

function formatUsdtUnits(value: bigint): string {
    const whole = value / BigInt(1_000_000);
    const fractional = (value % BigInt(1_000_000)).toString().padStart(6, '0');
    return `${whole}.${fractional}`;
}

function isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string; errno?: number };
    return (
        driverError.code === '23505' ||
        driverError.code === 'ER_DUP_ENTRY' ||
        driverError.code === 'SQLITE_CONSTRAINT' ||
        driverError.errno === 1062
    );
}

function isLockUnsupported(error: unknown): boolean {
    return error instanceof Error && /Locking not supported|pessimistic lock/iu.test(error.message);
}

function roundUsdt(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyChannelStats(channelId: string, channelCode: string): StoreUsdtChannelPaymentStats {
    return {
        channelId,
        channelCode,
        totalCount: 0,
        pendingCount: 0,
        settledCount: 0,
        manualReviewCount: 0,
        expiredCount: 0,
        expectedUsdtTotal: 0,
        receivedUsdtTotal: 0,
        fiatTotals: [],
    };
}

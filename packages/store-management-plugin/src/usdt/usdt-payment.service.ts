import { Injectable } from '@nestjs/common';
import {
    assertOrderSalesChannel,
    Channel,
    EventBus,
    ID,
    isGraphQlErrorResult,
    Order,
    OrderService,
    Payment,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { createHash, randomInt } from 'node:crypto';
import { In, IsNull, LessThan, Not, QueryFailedError, Repository } from 'typeorm';

import { StoreUsdtManualRefund } from '../entities/store-usdt-manual-refund.entity';
import {
    StoreUsdtReconciliationAction,
    StoreUsdtReconciliationActionType,
} from '../entities/store-usdt-reconciliation-action.entity';
import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { maskTronAddress, StoreUsdtWalletService } from './store-usdt-wallet.service';
import { loadReviewedRefundSenders } from './usdt-manual-refund.service';
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
const INVALIDATED_QUOTE_REASON_PREFIX = 'PAYMENT_CURRENCY_QUOTE_INVALIDATED:';

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
    manualReviewCode: string | null;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    resolutionActionId: string | null;
}

export interface StoreUsdtChannelPaymentStats {
    channelId: string;
    channelCode: string;
    totalCount: number;
    pendingCount: number;
    settledCount: number;
    manualReviewCount: number;
    expiredCount: number;
    resolvedCount: number;
    expectedUsdtTotal: number;
    receivedUsdtTotal: number;
    fiatTotals: Array<{ currencyCode: string; amount: number }>;
}

export interface ResolveStoreUsdtPaymentIntentInput {
    id: ID;
    action: StoreUsdtReconciliationActionType;
    reason: string;
    transactionId?: string | null;
    usdtAmount?: string | null;
    recipientAddress?: string | null;
}

export interface StoreUsdtReconciliationActionView {
    id: string;
    channelId: string;
    intentId: string;
    orderId: string;
    action: StoreUsdtReconciliationActionType;
    outcome: string;
    operatorUserId: string;
    reason: string;
    network: string | null;
    transactionId: string | null;
    usdtAmount: string | null;
    fromAddress: string | null;
    toAddress: string | null;
    blockNumber: number | null;
    blockTimestamp: Date | null;
    createdAt: Date;
}

@Injectable()
export class UsdtPaymentService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly requestContextService: RequestContextService,
        private readonly storeWallets: StoreUsdtWalletService,
        private readonly tronClient: UsdtTrc20Client,
        private readonly eventBus: EventBus,
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
            order: { createdAt: 'DESC', id: 'DESC' },
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
            order: { createdAt: 'DESC', id: 'DESC' },
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
            .addSelect('SUM(CASE WHEN intent.status = :resolvedStatus THEN 1 ELSE 0 END)', 'resolvedCount')
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
                resolvedStatus: USDT_PAYMENT_INTENT_STATUS.resolved,
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
            resolvedCount: string | number;
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
            summary.resolvedCount += Number(row.resolvedCount);
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

    async listReconciliationActions(
        ctx: RequestContext,
        channelId?: ID | null,
    ): Promise<StoreUsdtReconciliationActionView[]> {
        const actions = await this.connection.getRepository(ctx, StoreUsdtReconciliationAction).find({
            ...(channelId == null ? {} : { where: { channelId } }),
            order: { createdAt: 'DESC', id: 'DESC' },
            take: 200,
        });
        return actions.map(action => this.toReconciliationActionView(action));
    }

    async resolveManualReview(
        ctx: RequestContext,
        input: ResolveStoreUsdtPaymentIntentInput,
    ): Promise<StoreUsdtPaymentIntentView> {
        const operatorUserId = ctx.activeUserId;
        if (!operatorUserId) throw new UserInputError('请先登录后处理对账异常');
        const reason = input.reason.trim();
        if (reason.length < 2 || reason.length > 500) {
            throw new UserInputError('处理说明必须为 2 到 500 个字符');
        }
        const intent = await this.requireManualReviewIntent(ctx, input.id);
        if (input.action === 'RETRY_SETTLEMENT') {
            return this.retryManualReviewSettlement(ctx, intent, operatorUserId, reason);
        }
        if (input.action === 'CONFIRM_EXTERNAL_REFUND') {
            return this.confirmExternalRefund(ctx, intent, operatorUserId, reason, input);
        }
        throw new UserInputError('不支持的对账处理方式');
    }

    private async retryManualReviewSettlement(
        ctx: RequestContext,
        intent: StorefrontUsdtPaymentIntent,
        operatorUserId: ID,
        reason: string,
    ): Promise<StoreUsdtPaymentIntentView> {
        if (!['vendure-payment', 'order-validation-exception'].includes(intent.manualReviewCode ?? '')) {
            throw new UserInputError('该异常需先核对付款归属或钱包证据，不能直接重试入账');
        }
        const transfer = await this.requireStoredReceiptTransfer(intent);
        const actionRepository = this.connection.getRepository(ctx, StoreUsdtReconciliationAction);
        const action = await actionRepository.save(
            new StoreUsdtReconciliationAction({
                channelId: intent.channelId,
                intentId: intent.id,
                orderId: intent.orderId,
                action: 'RETRY_SETTLEMENT',
                outcome: 'STARTED',
                operatorUserId,
                reason,
                network: null,
                transactionId: null,
                usdtAmountBaseUnits: null,
                fromAddress: null,
                toAddress: null,
                blockNumber: null,
                blockTimestamp: null,
            }),
        );
        try {
            const status = await this.settleMatchedIntent(
                intent,
                transfer,
                transfer.blockNumber,
                new Date(),
                true,
            );
            action.outcome = status === USDT_PAYMENT_INTENT_STATUS.settled ? 'SETTLED' : 'MANUAL_REVIEW';
            await actionRepository.save(action, { reload: false });
            if (status === USDT_PAYMENT_INTENT_STATUS.settled) {
                await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).update(
                    { id: intent.id, status: USDT_PAYMENT_INTENT_STATUS.settled },
                    {
                        resolvedAt: new Date(),
                        resolvedByUserId: operatorUserId,
                        resolutionActionId: action.id,
                    },
                );
                await this.publishManualReviewResolved(ctx, intent, action);
            }
            return this.loadIntentView(ctx, intent.id);
        } catch (error) {
            action.outcome = 'FAILED';
            await actionRepository.save(action, { reload: false });
            throw error;
        }
    }

    private async confirmExternalRefund(
        ctx: RequestContext,
        intent: StorefrontUsdtPaymentIntent,
        operatorUserId: ID,
        reason: string,
        input: ResolveStoreUsdtPaymentIntentInput,
    ): Promise<StoreUsdtPaymentIntentView> {
        const transactionId = (input.transactionId ?? '').trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/u.test(transactionId)) {
            throw new UserInputError('TRON 退款交易哈希格式不正确');
        }
        if (transactionId === intent.transactionId?.toLowerCase()) {
            throw new UserInputError('退款交易不能与原收款交易相同');
        }
        const recipientAddress = (input.recipientAddress ?? '').trim();
        if (!isValidTronMainnetAddress(recipientAddress)) {
            throw new UserInputError('退款收款地址不是有效的 TRON 主网地址');
        }
        const usdtAmount = normalizeUsdtAmount(input.usdtAmount ?? '');
        if (usdtAmount !== normalizeUsdtAmount(intent.receivedUsdtAmount ?? intent.expectedUsdtAmount)) {
            throw new UserInputError('外部退款必须覆盖该异常收款的全部 USDT 金额');
        }
        await this.assertResolutionTransactionUnused(ctx, transactionId);
        const transfer = await this.tronClient.solidifiedUsdtTransfer(transactionId);
        if (!transfer) throw new UserInputError('该交易不是已固化成功的官方 USDT-TRC20 转账');
        if (transfer.amount !== usdtAmount || transfer.to !== recipientAddress) {
            throw new UserInputError('链上退款金额或收款地址与登记内容不一致');
        }
        const allowedSenders = loadReviewedRefundSenders(process.env);
        if (!allowedSenders.length || !allowedSenders.includes(transfer.from)) {
            throw new UserInputError('链上退款地址不在平台已审核钱包白名单中');
        }

        const locked = await this.findLockedIntent(ctx, intent.id);
        if (!locked || locked.status !== USDT_PAYMENT_INTENT_STATUS.manualReview) {
            throw new UserInputError('该付款异常已被其他操作处理');
        }
        try {
            const action = await this.connection.getRepository(ctx, StoreUsdtReconciliationAction).save(
                new StoreUsdtReconciliationAction({
                    channelId: locked.channelId,
                    intentId: locked.id,
                    orderId: locked.orderId,
                    action: 'CONFIRM_EXTERNAL_REFUND',
                    outcome: 'RESOLVED',
                    operatorUserId,
                    reason,
                    network: USDT_TRC20_NETWORK,
                    transactionId,
                    usdtAmountBaseUnits: usdtAmountToBaseUnits(usdtAmount).toString(),
                    fromAddress: transfer.from,
                    toAddress: transfer.to,
                    blockNumber: transfer.blockNumber,
                    blockTimestamp: transfer.blockTimestamp,
                }),
            );
            locked.status = USDT_PAYMENT_INTENT_STATUS.resolved;
            locked.activeMatchKey = null;
            locked.failureReason = '已核验全额链上退款，异常已闭环';
            locked.resolvedAt = new Date();
            locked.resolvedByUserId = operatorUserId;
            locked.resolutionActionId = action.id;
            await this.connection
                .getRepository(ctx, StorefrontUsdtPaymentIntent)
                .save(locked, { reload: false });
            await this.publishManualReviewResolved(ctx, locked, action);
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                throw new UserInputError('该链上交易已用于其他对账或退款记录');
            }
            throw error;
        }
        return this.loadIntentView(ctx, intent.id);
    }

    private async requireManualReviewIntent(
        ctx: RequestContext,
        intentId: ID,
    ): Promise<StorefrontUsdtPaymentIntent> {
        const intent = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOne({
            where: { id: intentId },
            relations: { channel: true, order: true, quote: true },
        });
        if (!intent) throw new UserInputError('找不到该 USDT 付款异常');
        if (intent.status !== USDT_PAYMENT_INTENT_STATUS.manualReview) {
            throw new UserInputError('只能处理待人工复核的 USDT 付款');
        }
        if (!intent.transactionId || !intent.receivedUsdtAmount || !intent.blockNumber) {
            throw new UserInputError('该异常缺少完整的链上到账证据');
        }
        return intent;
    }

    private async requireStoredReceiptTransfer(intent: StorefrontUsdtPaymentIntent) {
        const transactionId = intent.transactionId;
        if (!transactionId) throw new UserInputError('待复核付款缺少链上交易哈希');
        const transfer = await this.tronClient.solidifiedUsdtTransfer(transactionId);
        if (
            !transfer ||
            transfer.to !== intent.receivingAddress ||
            transfer.amount !== normalizeUsdtAmount(intent.receivedUsdtAmount ?? '') ||
            transfer.blockNumber !== intent.blockNumber ||
            (intent.senderAddress != null && transfer.from !== intent.senderAddress)
        ) {
            throw new UserInputError('链上付款证据与已保存的到账快照不一致');
        }
        return transfer;
    }

    private async assertResolutionTransactionUnused(
        ctx: RequestContext,
        transactionId: string,
    ): Promise<void> {
        const [intent, manualRefund, action] = await Promise.all([
            this.connection
                .getRepository(ctx, StorefrontUsdtPaymentIntent)
                .findOne({ where: { transactionId } }),
            this.connection
                .getRepository(ctx, StoreUsdtManualRefund)
                .findOne({ where: { network: USDT_TRC20_NETWORK, transactionId } }),
            this.connection
                .getRepository(ctx, StoreUsdtReconciliationAction)
                .findOne({ where: { network: USDT_TRC20_NETWORK, transactionId } }),
        ]);
        if (intent || manualRefund || action) {
            throw new UserInputError('该链上交易已用于收款、退款或对账记录');
        }
    }

    private async loadIntentView(ctx: RequestContext, intentId: ID): Promise<StoreUsdtPaymentIntentView> {
        const intent = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOne({
            where: { id: intentId },
            relations: { channel: true, order: true, quote: true },
        });
        if (!intent) throw new UserInputError('对账处理后无法重新读取付款记录');
        return this.toIntentView(intent);
    }

    private toReconciliationActionView(
        action: StoreUsdtReconciliationAction,
    ): StoreUsdtReconciliationActionView {
        return {
            id: String(action.id),
            channelId: String(action.channelId),
            intentId: String(action.intentId),
            orderId: String(action.orderId),
            action: action.action,
            outcome: action.outcome,
            operatorUserId: String(action.operatorUserId),
            reason: action.reason,
            network: action.network,
            transactionId: action.transactionId,
            usdtAmount:
                action.usdtAmountBaseUnits == null ? null : formatUsdtBaseUnits(action.usdtAmountBaseUnits),
            fromAddress: action.fromAddress,
            toAddress: action.toAddress,
            blockNumber: action.blockNumber,
            blockTimestamp: action.blockTimestamp,
            createdAt: action.createdAt,
        };
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
            manualReviewCode: intent.manualReviewCode,
            resolvedAt: intent.resolvedAt,
            resolvedByUserId: intent.resolvedByUserId == null ? null : String(intent.resolvedByUserId),
            resolutionActionId: intent.resolutionActionId == null ? null : String(intent.resolutionActionId),
        };
    }

    async ensureIntent(
        ctx: RequestContext,
        quote: StorefrontUsdtCheckoutQuote,
    ): Promise<StorefrontUsdtPaymentIntent> {
        await this.assertQuoteScope(ctx, quote);
        const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
        const existing = await repository.findOne({ where: { quoteId: quote.id } });
        if (existing) {
            this.assertIntentScope(existing, quote);
            return existing;
        }
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
            // ON CONFLICT DO NOTHING keeps a PostgreSQL transaction usable after a collision.
            await repository
                .createQueryBuilder()
                .insert()
                .values(
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
                        activeMatchKey: matchKey,
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
                        manualReviewCode: null,
                        resolvedAt: null,
                        resolvedByUserId: null,
                        resolutionActionId: null,
                        expiresAt: quote.expiresAt,
                    }),
                )
                .orIgnore()
                .updateEntity(false)
                .execute();
            const allocated = await findIntentForQuote(repository, quote.id);
            if (allocated) {
                this.assertIntentScope(allocated, quote);
                return allocated;
            }
        }
        throw new Error('当前 USDT 专属付款金额已用完，请稍后重新生成报价');
    }

    async expirePendingIntentsForOrder(
        ctx: RequestContext,
        orderId: ID,
        reason: string,
        exceptQuoteId?: ID,
    ): Promise<number> {
        const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
        const intents = await repository.find({
            where: {
                orderId,
                status: USDT_PAYMENT_INTENT_STATUS.pending,
                ...(exceptQuoteId == null ? {} : { quoteId: Not(exceptQuoteId) }),
            },
        });
        if (!intents.length) return 0;

        const now = new Date();
        const failureReason = `${INVALIDATED_QUOTE_REASON_PREFIX}${reason}`.slice(0, 500);
        for (const intent of intents) {
            intent.status = USDT_PAYMENT_INTENT_STATUS.expired;
            intent.failureReason = failureReason;
            intent.expiresAt = now;
        }
        await repository.save(intents, { reload: false });
        await this.connection
            .getRepository(ctx, StorefrontUsdtCheckoutQuote)
            .update({ id: In(intents.map(intent => intent.quoteId)) }, { expiresAt: now });
        return intents.length;
    }

    private async assertQuoteScope(ctx: RequestContext, quote: StorefrontUsdtCheckoutQuote): Promise<void> {
        if (String(quote.channelId) !== String(ctx.channelId)) {
            throw new UserInputError('USDT 报价不属于当前店铺');
        }
        const order = await this.connection.getEntityOrThrow(ctx, Order, quote.orderId);
        assertOrderSalesChannel(ctx, order);
    }

    private assertIntentScope(intent: StorefrontUsdtPaymentIntent, quote: StorefrontUsdtCheckoutQuote): void {
        if (
            String(intent.channelId) !== String(quote.channelId) ||
            String(intent.orderId) !== String(quote.orderId) ||
            String(intent.quoteId) !== String(quote.id)
        ) {
            throw new UserInputError('USDT 付款请求与报价归属不一致，请人工核对');
        }
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
        // Scan old pending/expired windows before releasing them, including after worker downtime.
        const pending = await repository.find({
            where: [
                { status: USDT_PAYMENT_INTENT_STATUS.pending },
                {
                    status: In([USDT_PAYMENT_INTENT_STATUS.expired, USDT_PAYMENT_INTENT_STATUS.settled]),
                    activeMatchKey: Not(IsNull()),
                },
            ],
            relations: { channel: true, quote: true },
            order: { createdAt: 'ASC' },
        });
        result.pendingIntentCount = pending.filter(
            intent => intent.status === USDT_PAYMENT_INTENT_STATUS.pending,
        ).length;
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
            const scan = await this.tronClient.scanIncomingTransfers(
                receivingAddress,
                new Date(oldestCreatedAt.getTime() - PAYMENT_MATCH_GRACE_MS),
                now,
            );
            const claimed = scan.transfers.length
                ? await repository.find({
                      where: { transactionId: In(scan.transfers.map(transfer => transfer.transactionId)) },
                  })
                : [];
            const claimedIds = new Set(claimed.map(intent => intent.transactionId));
            const transfers = scan.transfers.filter(transfer => !claimedIds.has(transfer.transactionId));
            result.transferCount += scan.transfers.length;
            const matches = new Map<string, ConfirmedTrc20Transfer>();
            const matchedTransactionIds = new Set<string>();
            for (const intent of addressIntents) {
                if (intent.status === USDT_PAYMENT_INTENT_STATUS.settled) continue;
                const transfer = findMatchingTransfer(intent, transfers);
                if (!transfer) continue;
                matches.set(String(intent.id), transfer);
                matchedTransactionIds.add(transfer.transactionId);
            }
            for (const transfer of findUnmatchedTransfers(addressIntents, transfers, matchedTransactionIds)) {
                const solidified = await this.tronClient.solidifiedTransaction(transfer.transactionId);
                if (!solidified) continue;
                await this.publishAmountMismatch(ctx, addressIntents, transfer, solidified.blockNumber);
            }
            for (const intent of addressIntents) {
                const transfer = matches.get(String(intent.id));
                if (transfer) {
                    const solidified = await this.tronClient.solidifiedTransaction(transfer.transactionId);
                    // A transfer without finality still owns its old payment window.
                    if (!solidified) continue;
                    try {
                        intent.status = await this.settleMatchedIntent(
                            intent,
                            transfer,
                            solidified.blockNumber,
                            now,
                        );
                    } catch (error) {
                        await this.publishManualReview(
                            ctx,
                            intent,
                            `USDT 入账后未能完整落库：${safeError(error)}`,
                            transfer,
                            'payment-persistence',
                        );
                        throw error;
                    }
                    if (intent.status === USDT_PAYMENT_INTENT_STATUS.settled) result.settledCount += 1;
                    if (intent.status === USDT_PAYMENT_INTENT_STATUS.manualReview)
                        result.manualReviewCount += 1;
                }
                if (intent.status === USDT_PAYMENT_INTENT_STATUS.manualReview) continue;
                const releasable = scan.complete && intent.expiresAt < expiryCutoff;
                const status =
                    releasable && intent.status === USDT_PAYMENT_INTENT_STATUS.pending
                        ? USDT_PAYMENT_INTENT_STATUS.expired
                        : intent.status;
                // A stale worker snapshot must never overwrite a concurrent settlement or manual review.
                const updated = await repository.update(
                    {
                        id: intent.id,
                        status: intent.status,
                        ...(releasable
                            ? {
                                  activeMatchKey: intent.activeMatchKey ?? IsNull(),
                                  expiresAt: LessThan(expiryCutoff),
                              }
                            : {}),
                    },
                    { lastCheckedAt: now, ...(releasable ? { status, activeMatchKey: null } : {}) },
                );
                if (
                    updated.affected &&
                    status === USDT_PAYMENT_INTENT_STATUS.expired &&
                    intent.status !== status
                ) {
                    result.expiredCount += 1;
                }
            }
        }
        return result;
    }

    private async settleMatchedIntent(
        intent: StorefrontUsdtPaymentIntent,
        transfer: ConfirmedTrc20Transfer,
        blockNumber: number,
        now: Date,
        allowManualReviewRetry = false,
    ): Promise<StorefrontUsdtPaymentIntent['status']> {
        const channelContext = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: intent.channel,
        });
        // Commit verified receipt evidence before any order/discount validation can fail.
        // This transaction is intentionally separate from the later fulfillment transaction.
        const receiptStatus = await this.orderService.withOrderMutationTransaction(
            channelContext,
            async ctx => {
                const locked = await this.findLockedIntent(ctx, intent.id);
                const allowedStatuses: Array<StorefrontUsdtPaymentIntent['status']> = allowManualReviewRetry
                    ? ['PENDING', 'EXPIRED', 'MANUAL_REVIEW']
                    : ['PENDING', 'EXPIRED'];
                if (!locked || !allowedStatuses.includes(locked.status) || !locked.activeMatchKey)
                    return locked?.status ?? USDT_PAYMENT_INTENT_STATUS.manualReview;
                const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
                const claimed = await repository.findOne({
                    where: { transactionId: transfer.transactionId },
                });
                if (claimed && String(claimed.id) !== String(locked.id)) return locked.status;
                if (locked.transactionId && locked.transactionId !== transfer.transactionId) {
                    locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                    locked.failureReason = '同一付款请求收到多笔转账，请人工核对';
                    locked.manualReviewCode = 'multiple-receipts';
                    await repository.save(locked, { reload: false });
                    await this.publishManualReview(
                        ctx,
                        locked,
                        locked.failureReason,
                        transfer,
                        'multiple-receipts',
                    );
                    return locked.status;
                }
                locked.transactionId = transfer.transactionId;
                locked.senderAddress = transfer.from;
                locked.receivedUsdtAmount = transfer.amount;
                locked.blockNumber = blockNumber;
                locked.blockTimestamp = transfer.blockTimestamp;
                locked.lastCheckedAt = now;
                await repository.save(locked, { reload: false });
                return null;
            },
        );
        if (receiptStatus) return receiptStatus;
        try {
            return await this.orderService.withOrderMutationTransaction(channelContext, async ctx => {
                const repository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
                const locked = await this.findLockedIntent(ctx, intent.id);
                const allowedStatuses: Array<StorefrontUsdtPaymentIntent['status']> = allowManualReviewRetry
                    ? [
                          USDT_PAYMENT_INTENT_STATUS.pending,
                          USDT_PAYMENT_INTENT_STATUS.expired,
                          USDT_PAYMENT_INTENT_STATUS.manualReview,
                      ]
                    : [USDT_PAYMENT_INTENT_STATUS.pending, USDT_PAYMENT_INTENT_STATUS.expired];
                if (!locked || !allowedStatuses.includes(locked.status) || !locked.activeMatchKey) {
                    return locked?.status ?? USDT_PAYMENT_INTENT_STATUS.manualReview;
                }
                const claimed = await repository.findOne({
                    where: { transactionId: transfer.transactionId },
                });
                if (claimed && String(claimed.id) !== String(locked.id)) return locked.status;
                const history = await repository.findOne({
                    where: { matchKey: locked.matchKey, id: Not(locked.id) },
                });
                locked.transactionId = transfer.transactionId;
                locked.senderAddress = transfer.from;
                locked.receivedUsdtAmount = transfer.amount;
                locked.blockNumber = blockNumber;
                locked.blockTimestamp = transfer.blockTimestamp;
                locked.lastCheckedAt = now;
                // Claim the transaction before calling Vendure or notifying operators. The unique index
                // also arbitrates different workers trying to attach one transfer to different intents.
                await repository.save(locked, { reload: false });
                if (locked.failureReason?.startsWith(INVALIDATED_QUOTE_REASON_PREFIX)) {
                    locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                    locked.failureReason =
                        '已确认链上到账，但原 USDT 报价在付款前已失效，请人工核对并避免重复入账';
                    locked.manualReviewCode = 'invalidated-quote';
                    await repository.save(locked, { reload: false });
                    await this.publishManualReview(
                        ctx,
                        locked,
                        locked.failureReason,
                        transfer,
                        'invalidated-quote',
                    );
                    return locked.status;
                }
                if (history) {
                    locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                    locked.failureReason = '付款金额曾用于其他报价，需核实付款归属后处理';
                    locked.manualReviewCode = 'reused-amount';
                    await repository.save(locked, { reload: false });
                    await this.publishManualReview(
                        ctx,
                        locked,
                        locked.failureReason,
                        transfer,
                        'reused-amount',
                    );
                    return locked.status;
                }
                if (
                    locked.network !== USDT_TRC20_NETWORK ||
                    locked.tokenContractAddress !== USDT_TRC20_CONTRACT_ADDRESS ||
                    !isValidTronMainnetAddress(locked.receivingAddress) ||
                    locked.receivingAddressFingerprint !==
                        fingerprintReceivingAddress(locked.receivingAddress)
                ) {
                    locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                    locked.failureReason = '订单绑定的收款钱包快照未通过完整性校验';
                    locked.manualReviewCode = 'wallet-snapshot';
                    await repository.save(locked, { reload: false });
                    await this.publishManualReview(
                        ctx,
                        locked,
                        locked.failureReason,
                        transfer,
                        'wallet-snapshot',
                    );
                    return locked.status;
                }

                const quote = await this.connection.getEntityOrThrow(
                    ctx,
                    StorefrontUsdtCheckoutQuote,
                    locked.quoteId,
                );
                this.assertIntentScope(locked, quote);
                await this.assertQuoteScope(ctx, quote);
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
                    paidAt: transfer.blockTimestamp.getTime(),
                });
                const paymentResult = await this.orderService.addPaymentToOrder(ctx, locked.orderId, {
                    method: USDT_TRC20_PAYMENT_METHOD_CODE,
                    metadata: { proof },
                });
                if (isGraphQlErrorResult(paymentResult)) {
                    locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                    locked.failureReason = (
                        'paymentErrorMessage' in paymentResult
                            ? String(paymentResult.paymentErrorMessage)
                            : paymentResult.message
                    ).slice(0, 500);
                    locked.manualReviewCode = 'vendure-payment';
                    await repository.save(locked, { reload: false });
                    await this.publishManualReview(
                        ctx,
                        locked,
                        locked.failureReason,
                        transfer,
                        'vendure-payment',
                    );
                    return locked.status;
                }

                const payment = await this.connection.getRepository(ctx, Payment).findOne({
                    where: { transactionId: `tron:${transfer.transactionId}` },
                    relations: { order: true },
                });
                if (
                    !payment ||
                    payment.state !== 'Settled' ||
                    String(payment.order?.id) !== String(locked.orderId)
                ) {
                    throw new Error('USDT payment was not persisted in the Settled state');
                }
                locked.paymentId = payment.id;
                locked.status = USDT_PAYMENT_INTENT_STATUS.settled;
                locked.settledAt = now;
                locked.failureReason = null;
                locked.manualReviewCode = null;
                await repository.save(locked, { reload: false });
                return locked.status;
            });
        } catch {
            // The receipt above remains committed even if a pricing hook or transaction fails.
            return this.orderService.withOrderMutationTransaction(channelContext, async ctx => {
                const locked = await this.findLockedIntent(ctx, intent.id);
                if (!locked) return USDT_PAYMENT_INTENT_STATUS.manualReview;
                if (locked.status === USDT_PAYMENT_INTENT_STATUS.settled) return locked.status;
                locked.status = USDT_PAYMENT_INTENT_STATUS.manualReview;
                locked.failureReason = '已确认到账，订单校验或入账处理异常，请人工核对；请勿重复付款';
                locked.manualReviewCode = 'order-validation-exception';
                await this.connection
                    .getRepository(ctx, StorefrontUsdtPaymentIntent)
                    .save(locked, { reload: false });
                await this.publishManualReview(
                    ctx,
                    locked,
                    locked.failureReason,
                    transfer,
                    'order-validation-exception',
                );
                return locked.status;
            });
        }
    }

    private async publishAmountMismatch(
        ctx: RequestContext,
        intents: StorefrontUsdtPaymentIntent[],
        transfer: ConfirmedTrc20Transfer,
        blockNumber: number,
    ): Promise<void> {
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                eventType: 'commerce.payment.amount_mismatch',
                category: 'PAYMENT',
                severity: 'P0',
                sourceType: 'Trc20Transfer',
                sourceId: transfer.transactionId,
                dedupKey: `commerce.payment.amount_mismatch:${transfer.transactionId}`,
                title: 'USDT 收款金额未匹配待支付订单',
                payload: {
                    channelIds: [...new Set(intents.map(intent => String(intent.channelId)))],
                    intentIds: intents.map(intent => String(intent.id)),
                    expectedAmounts: [...new Set(intents.map(intent => intent.expectedUsdtAmount))],
                    receivedAmount: transfer.amount,
                    transactionId: transfer.transactionId,
                    blockNumber,
                    blockTimestamp: transfer.blockTimestamp.toISOString(),
                    receivingAddress: maskTronAddress(transfer.to),
                    senderAddress: maskTronAddress(transfer.from),
                    adminPath: '/settings/usdt-payments',
                },
            }),
        );
    }

    private async publishManualReview(
        ctx: RequestContext,
        intent: StorefrontUsdtPaymentIntent,
        reason: string,
        transfer: ConfirmedTrc20Transfer,
        reasonCode: string,
    ): Promise<void> {
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_FIRING',
                eventType: 'commerce.payment.manual_review',
                category: 'PAYMENT',
                severity: 'P0',
                sourceType: 'StorefrontUsdtPaymentIntent',
                sourceId: String(intent.id),
                fingerprint: `commerce.payment.manual_review:${intent.id}`,
                title: 'USDT 付款需要立即人工复核',
                payload: {
                    channelId: String(intent.channelId),
                    intentId: String(intent.id),
                    orderId: String(intent.orderId),
                    expectedAmount: intent.expectedUsdtAmount,
                    receivedAmount: transfer.amount,
                    transactionId: transfer.transactionId,
                    reasonCode,
                    reason: safeError(reason),
                    adminPath: '/settings/usdt-payments',
                },
            }),
        );
    }

    private async publishManualReviewResolved(
        ctx: RequestContext,
        intent: StorefrontUsdtPaymentIntent,
        action: StoreUsdtReconciliationAction,
    ): Promise<void> {
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: 'INCIDENT_RESOLVED',
                eventType: 'commerce.payment.manual_review',
                category: 'PAYMENT',
                severity: 'P0',
                sourceType: 'StorefrontUsdtPaymentIntent',
                sourceId: String(intent.id),
                fingerprint: `commerce.payment.manual_review:${intent.id}`,
                title: 'USDT 付款人工复核已闭环',
                payload: {
                    channelId: String(intent.channelId),
                    intentId: String(intent.id),
                    orderId: String(intent.orderId),
                    action: action.action,
                    outcome: action.outcome,
                    operatorUserId: String(action.operatorUserId),
                    adminPath: '/settings/usdt-payments',
                },
            }),
        );
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

export function findUnmatchedTransfers(
    intents: Array<
        Pick<
            StorefrontUsdtPaymentIntent,
            'expectedUsdtAmount' | 'receivingAddress' | 'createdAt' | 'expiresAt'
        >
    >,
    transfers: ConfirmedTrc20Transfer[],
    matchedTransactionIds: ReadonlySet<string>,
): ConfirmedTrc20Transfer[] {
    return transfers.filter(transfer => {
        if (matchedTransactionIds.has(transfer.transactionId)) return false;
        return intents.some(intent => {
            const earliest = intent.createdAt.getTime() - PAYMENT_MATCH_GRACE_MS;
            const latest = intent.expiresAt.getTime() + PAYMENT_MATCH_GRACE_MS;
            const timestamp = transfer.blockTimestamp.getTime();
            return (
                transfer.to === intent.receivingAddress &&
                transfer.amount !== intent.expectedUsdtAmount &&
                timestamp >= earliest &&
                timestamp <= latest
            );
        });
    });
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

function formatUsdtBaseUnits(value: string): string {
    const units = BigInt(value);
    return formatUsdtUnits(units);
}

async function findIntentForQuote(
    repository: Repository<StorefrontUsdtPaymentIntent>,
    quoteId: StorefrontUsdtCheckoutQuote['id'],
): Promise<StorefrontUsdtPaymentIntent | null> {
    const query = repository.createQueryBuilder('intent').where('intent.quoteId = :quoteId', { quoteId });
    const databaseType = repository.manager.connection.options.type;
    if (
        repository.manager.queryRunner?.isTransactionActive &&
        ['mysql', 'mariadb', 'postgres'].includes(databaseType)
    ) {
        // A current read can see the concurrent insert even under MySQL REPEATABLE READ.
        query.setLock('pessimistic_read');
    }
    return query.getOne();
}

function isLockUnsupported(error: unknown): boolean {
    return error instanceof Error && /Locking not supported|pessimistic lock/iu.test(error.message);
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

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
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
        resolvedCount: 0,
        expectedUsdtTotal: 0,
        receivedUsdtTotal: 0,
        fiatTotals: [],
    };
}

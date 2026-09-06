import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ForbiddenError,
    idsAreEqual,
    isGraphQlErrorResult,
    Order,
    OrderService,
    Payment,
    Permission,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, QueryFailedError } from 'typeorm';

import { StoreUsdtManualRefund } from '../entities/store-usdt-manual-refund.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';
import { normalizeStoreReportOptions, StoreReportListOptions } from '../store-reporting-options';

import {
    USDT_PAYMENT_INTENT_STATUS,
    USDT_TRC20_NETWORK,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt-payment.constants';
import { UsdtTrc20Client } from './usdt-trc20-client';
import { isValidTronMainnetAddress } from './usdt-wallet-configuration.service';

const REFUND_TRANSACTION_PREFIX = 'tron:';
const MERCHANT_REFUND_LIMIT = 100;
const PLATFORM_REFUND_LIMIT = 200;

export interface StoreUsdtManualRefundInput {
    paymentId: ID;
    amount: number;
    usdtAmount: string;
    recipientAddress: string;
    transactionId: string;
    reason: string;
}

export interface StoreUsdtManualRefundView {
    id: string;
    refundId: string;
    channelId: string;
    channelCode: string;
    paymentId: string;
    orderId: string;
    orderCode: string;
    currencyCode: string;
    amount: number;
    usdtAmount: string;
    network: string;
    transactionId: string;
    fromAddress: string;
    toAddress: string;
    blockNumber: number;
    blockTimestamp: Date;
    reason: string;
    operatorUserId: string;
    state: string;
    createdAt: Date;
}

export interface StoreUsdtManualRefundList {
    items: StoreUsdtManualRefundView[];
    totalItems: number;
}

interface UsdtPaymentContext {
    payment: Payment;
    intent: StorefrontUsdtPaymentIntent;
}

@Injectable()
export class UsdtManualRefundService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly tronClient: UsdtTrc20Client,
    ) {}

    listForChannel(
        ctx: RequestContext,
        options?: StoreReportListOptions | null,
    ): Promise<StoreUsdtManualRefundList> {
        return this.list(ctx, ctx.channelId, options, MERCHANT_REFUND_LIMIT);
    }

    listForPlatform(
        ctx: RequestContext,
        channelId?: ID | null,
        options?: StoreReportListOptions | null,
    ): Promise<StoreUsdtManualRefundList> {
        return this.list(ctx, channelId, options, PLATFORM_REFUND_LIMIT);
    }

    async record(ctx: RequestContext, input: StoreUsdtManualRefundInput): Promise<StoreUsdtManualRefundView> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录后登记退款');
        const normalized = normalizeInput(input);
        const initialContext = await this.requirePaymentContext(ctx, input.paymentId);
        this.assertAuthorized(ctx, initialContext.intent);
        this.assertRefundable(initialContext.payment, normalized.amount);
        if (initialContext.intent.transactionId?.toLowerCase() === normalized.transactionId) {
            throw new UserInputError('退款交易哈希不能与原收款交易哈希相同');
        }
        await this.assertTransactionUnused(ctx, normalized.transactionId);

        const allowedSenders = loadReviewedRefundSenders(process.env);
        if (!allowedSenders.length) {
            throw new UserInputError('平台尚未配置经过审核的 USDT 退款钱包');
        }
        const transfer = await this.tronClient.solidifiedUsdtTransfer(normalized.transactionId);
        if (!transfer) {
            throw new UserInputError('该交易不是已固化成功的官方 USDT-TRC20 转账');
        }
        if (transfer.amount !== normalized.usdtAmount) {
            throw new UserInputError(`链上 USDT 数量为 ${transfer.amount}，与登记数量不一致`);
        }
        if (transfer.to !== normalized.recipientAddress) {
            throw new UserInputError('链上收款地址与登记的客户退款地址不一致');
        }
        if (!allowedSenders.includes(transfer.from)) {
            throw new UserInputError('链上付款地址不在平台审核通过的退款钱包白名单中');
        }

        try {
            return await this.connection.withTransaction(ctx, async txCtx => {
                await this.lockPayment(txCtx, input.paymentId);
                const paymentContext = await this.requirePaymentContext(txCtx, input.paymentId);
                this.assertAuthorized(txCtx, paymentContext.intent);
                this.assertRefundable(paymentContext.payment, normalized.amount);
                await this.assertTransactionUnused(txCtx, normalized.transactionId);
                const operatorUserId = txCtx.activeUserId;
                if (!operatorUserId) throw new UserInputError('请先登录后登记退款');

                const created = await this.orderService.refundOrder(txCtx, {
                    paymentId: paymentContext.payment.id,
                    amount: normalized.amount,
                    reason: normalized.reason,
                });
                if (isGraphQlErrorResult(created)) throw new UserInputError(created.message);

                const settled = await this.orderService.settleRefund(txCtx, {
                    id: created.id,
                    transactionId: `${REFUND_TRANSACTION_PREFIX}${normalized.transactionId}`,
                });
                const audit = await this.connection.getRepository(txCtx, StoreUsdtManualRefund).save(
                    new StoreUsdtManualRefund({
                        channelId: paymentContext.intent.channelId,
                        paymentId: paymentContext.payment.id,
                        orderId: paymentContext.payment.order.id,
                        refundId: settled.id,
                        network: USDT_TRC20_NETWORK,
                        transactionId: normalized.transactionId,
                        usdtAmountBaseUnits: usdtAmountToBaseUnits(normalized.usdtAmount),
                        fromAddress: transfer.from,
                        toAddress: transfer.to,
                        blockNumber: transfer.blockNumber,
                        blockTimestamp: transfer.blockTimestamp,
                        operatorUserId,
                        reason: normalized.reason,
                    }),
                );
                return this.toView(
                    audit,
                    settled,
                    paymentContext.payment.order,
                    paymentContext.intent.channel,
                );
            });
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                throw new UserInputError('该链上交易哈希已经登记过退款');
            }
            throw error;
        }
    }

    private async list(
        ctx: RequestContext,
        channelId: ID | null | undefined,
        options: StoreReportListOptions | null | undefined,
        maximumTake: number,
    ): Promise<StoreUsdtManualRefundList> {
        const normalized = normalizeStoreReportOptions(options, Math.min(50, maximumTake), maximumTake);
        const where: FindOptionsWhere<StoreUsdtManualRefund> = {};
        if (channelId != null) where.channelId = channelId;
        if (normalized.from && normalized.to) {
            where.createdAt = Between(normalized.from, normalized.to);
        } else if (normalized.from) {
            where.createdAt = MoreThanOrEqual(normalized.from);
        } else if (normalized.to) {
            where.createdAt = LessThanOrEqual(normalized.to);
        }
        const [records, totalItems] = await this.connection
            .getRepository(ctx, StoreUsdtManualRefund)
            .findAndCount({
                where,
                relations: { channel: true, payment: true, order: true, refund: true },
                order: { createdAt: 'DESC', id: 'DESC' },
                skip: normalized.skip,
                take: normalized.take,
            });
        return {
            items: records.map(record => this.toView(record, record.refund, record.order, record.channel)),
            totalItems,
        };
    }

    private async requirePaymentContext(ctx: RequestContext, paymentId: ID): Promise<UsdtPaymentContext> {
        const payment = await this.connection.getRepository(ctx, Payment).findOne({
            where: { id: paymentId },
            relations: { order: { channels: true }, refunds: true },
        });
        if (!payment) throw new UserInputError('找不到该支付记录');
        if (payment.method !== USDT_TRC20_PAYMENT_METHOD_CODE) {
            throw new UserInputError('该支付不是 USDT-TRC20 支付');
        }
        if (payment.state !== 'Settled') throw new UserInputError('只有已结算的 USDT 支付可以登记退款');

        const intent = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOne({
            where: {
                paymentId: payment.id,
                status: USDT_PAYMENT_INTENT_STATUS.settled,
            },
            relations: { channel: true, order: true, quote: true },
        });
        if (!intent || !idsAreEqual(intent.orderId, payment.order.id)) {
            throw new UserInputError('该支付缺少已确认的 USDT 链上到账记录');
        }
        return { payment, intent };
    }

    private assertAuthorized(ctx: RequestContext, intent: StorefrontUsdtPaymentIntent): void {
        const isSuperAdmin = ctx.userHasPermissions([Permission.SuperAdmin]);
        if (!isSuperAdmin && !idsAreEqual(intent.channelId, ctx.channelId)) throw new ForbiddenError();
    }

    private assertRefundable(payment: Payment, amount: number): void {
        const alreadyRefunded = (payment.refunds ?? [])
            .filter(refund => refund.state !== 'Failed')
            .reduce((sum, refund) => sum + refund.total, 0);
        const remaining = payment.amount - alreadyRefunded;
        if (amount > remaining) {
            throw new UserInputError(`退款金额超过可退余额，当前最多可退 ${(remaining / 100).toFixed(2)}`);
        }
    }

    private async assertTransactionUnused(ctx: RequestContext, transactionId: string): Promise<void> {
        const inboundIntent = await this.connection
            .getRepository(ctx, StorefrontUsdtPaymentIntent)
            .findOne({ where: { transactionId } });
        if (inboundIntent) throw new UserInputError('该交易哈希已经作为 USDT 收款凭证使用');

        const duplicate = await this.connection.getRepository(ctx, StoreUsdtManualRefund).findOne({
            where: { network: USDT_TRC20_NETWORK, transactionId },
        });
        if (duplicate) throw new UserInputError('该交易哈希已经登记过退款');

        const legacyRefund = await this.connection
            .getRepository(ctx, Refund)
            .createQueryBuilder('refund')
            .where('LOWER(refund.transactionId) = :transactionId', {
                transactionId: `${REFUND_TRANSACTION_PREFIX}${transactionId}`,
            })
            .getOne();
        if (legacyRefund) throw new UserInputError('该交易哈希已经登记过退款');
    }

    private async lockPayment(ctx: RequestContext, paymentId: ID): Promise<void> {
        try {
            await this.connection
                .getRepository(ctx, Payment)
                .createQueryBuilder('payment')
                .setLock('pessimistic_write')
                .where('payment.id = :paymentId', { paymentId })
                .getOne();
        } catch (error) {
            if (!isLockUnsupported(error)) throw error;
        }
    }

    private toView(
        record: StoreUsdtManualRefund,
        refund: Refund,
        order: Order,
        channel: { code: string },
    ): StoreUsdtManualRefundView {
        return {
            id: String(record.id),
            refundId: String(record.refundId),
            channelId: String(record.channelId),
            channelCode: channel.code,
            paymentId: String(record.paymentId),
            orderId: String(record.orderId),
            orderCode: order.code,
            currencyCode: String(order.currencyCode),
            amount: refund.total,
            usdtAmount: formatUsdtBaseUnits(record.usdtAmountBaseUnits),
            network: record.network,
            transactionId: record.transactionId,
            fromAddress: record.fromAddress,
            toAddress: record.toAddress,
            blockNumber: record.blockNumber,
            blockTimestamp: record.blockTimestamp,
            reason: record.reason,
            operatorUserId: String(record.operatorUserId),
            state: refund.state,
            createdAt: record.createdAt,
        };
    }
}

function normalizeInput(input: StoreUsdtManualRefundInput) {
    const amount = Number(input.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserInputError('退款金额必须大于 0');
    const usdtAmount = input.usdtAmount.trim();
    if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u.test(usdtAmount) || Number(usdtAmount) <= 0) {
        throw new UserInputError('实际退款 USDT 必须大于 0，且最多保留 6 位小数');
    }
    const recipientAddress = input.recipientAddress.trim();
    if (!isValidTronMainnetAddress(recipientAddress)) {
        throw new UserInputError('客户退款地址不是有效的 TRON 主网地址');
    }
    const transactionId = input.transactionId.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(transactionId)) throw new UserInputError('TRON 交易哈希格式不正确');
    const reason = input.reason.trim();
    if (reason.length < 2 || reason.length > 500) {
        throw new UserInputError('退款原因必须为 2 到 500 个字符');
    }
    return {
        amount,
        usdtAmount: normalizeUsdtAmount(usdtAmount),
        recipientAddress,
        transactionId,
        reason,
    };
}

export function loadReviewedRefundSenders(environment: NodeJS.ProcessEnv): string[] {
    const values = (environment.USDT_REFUND_SENDER_ADDRESSES ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (values.some(value => !isValidTronMainnetAddress(value))) {
        throw new Error('USDT_REFUND_SENDER_ADDRESSES contains an invalid TRON mainnet address');
    }
    return Array.from(new Set(values));
}

function normalizeUsdtAmount(value: string): string {
    const [whole, fractional = ''] = value.split('.');
    return `${whole}.${fractional.padEnd(6, '0')}`;
}

function usdtAmountToBaseUnits(value: string): string {
    const [whole, fractional] = value.split('.');
    return (BigInt(whole) * BigInt(1_000_000) + BigInt(fractional)).toString();
}

function formatUsdtBaseUnits(value: string): string {
    const units = BigInt(value);
    return `${units / BigInt(1_000_000)}.${(units % BigInt(1_000_000)).toString().padStart(6, '0')}`;
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

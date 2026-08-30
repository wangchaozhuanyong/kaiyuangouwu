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

import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import {
    USDT_PAYMENT_INTENT_STATUS,
    USDT_TRC20_NETWORK,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt-payment.constants';
import { UsdtTrc20Client } from './usdt-trc20-client';

const MANUAL_REFUND_METADATA_KEY = 'manualUsdtRefund';
const REFUND_TRANSACTION_PREFIX = 'tron:';
const MERCHANT_REFUND_LIMIT = 100;
const PLATFORM_REFUND_LIMIT = 200;

export interface StoreUsdtManualRefundInput {
    paymentId: ID;
    amount: number;
    usdtAmount: string;
    transactionId: string;
    reason: string;
}

export interface StoreUsdtManualRefundView {
    id: string;
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
    blockNumber: number;
    reason: string;
    operatorUserId: string;
    state: string;
    createdAt: Date;
}

interface ManualUsdtRefundMetadata {
    channelId: string;
    network: string;
    usdtAmount: string;
    transactionId: string;
    blockNumber: number;
    operatorUserId: string;
    registeredAt: string;
}

interface UsdtPaymentContext {
    payment: Payment;
    intent: StorefrontUsdtPaymentIntent;
}

interface RefundChannelContext {
    channelId: ID;
    channel: { code: string };
}

@Injectable()
export class UsdtManualRefundService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly tronClient: UsdtTrc20Client,
    ) {}

    listForChannel(ctx: RequestContext): Promise<StoreUsdtManualRefundView[]> {
        return this.list(ctx, ctx.channelId, MERCHANT_REFUND_LIMIT);
    }

    listForPlatform(ctx: RequestContext, channelId?: ID | null): Promise<StoreUsdtManualRefundView[]> {
        return this.list(ctx, channelId, PLATFORM_REFUND_LIMIT);
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
        const solidified = await this.tronClient.solidifiedTransaction(normalized.transactionId);
        if (!solidified) throw new UserInputError('该 TRON 交易尚未成功固化，暂不能登记退款');

        return this.connection.withTransaction(ctx, async txCtx => {
            await this.lockPayment(txCtx, input.paymentId);
            const paymentContext = await this.requirePaymentContext(txCtx, input.paymentId);
            this.assertAuthorized(txCtx, paymentContext.intent);
            this.assertRefundable(paymentContext.payment, normalized.amount);
            await this.assertTransactionUnused(txCtx, normalized.transactionId);

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
            const metadata: ManualUsdtRefundMetadata = {
                channelId: String(paymentContext.intent.channelId),
                network: USDT_TRC20_NETWORK,
                usdtAmount: normalized.usdtAmount,
                transactionId: normalized.transactionId,
                blockNumber: solidified.blockNumber,
                operatorUserId: String(txCtx.activeUserId),
                registeredAt: new Date().toISOString(),
            };
            settled.metadata = {
                ...(settled.metadata ?? {}),
                [MANUAL_REFUND_METADATA_KEY]: metadata,
            };
            await this.connection.getRepository(txCtx, Refund).save(settled, { reload: false });
            return this.toView(settled, paymentContext.payment.order, paymentContext.intent, metadata);
        });
    }

    private async list(
        ctx: RequestContext,
        channelId: ID | null | undefined,
        limit: number,
    ): Promise<StoreUsdtManualRefundView[]> {
        const query = this.connection
            .getRepository(ctx, Refund)
            .createQueryBuilder('refund')
            .innerJoinAndSelect('refund.payment', 'payment')
            .innerJoinAndSelect('payment.order', 'order')
            .innerJoinAndSelect('order.channels', 'channel')
            .where('payment.method = :method', { method: USDT_TRC20_PAYMENT_METHOD_CODE })
            .andWhere('refund.state = :state', { state: 'Settled' })
            .orderBy('refund.createdAt', 'DESC')
            .take(Math.max(1, Math.min(PLATFORM_REFUND_LIMIT, limit)));
        if (channelId != null) query.andWhere('channel.id = :channelId', { channelId });
        const refunds = await query.getMany();

        return refunds.flatMap(refund => {
            const metadata = readManualRefundMetadata(refund.metadata);
            if (!metadata) return [];
            if (channelId != null && !idsAreEqual(metadata.channelId, channelId)) return [];
            const channel = refund.payment.order.channels.find(candidate =>
                idsAreEqual(candidate.id, metadata.channelId),
            );
            if (!channel) return [];
            return [this.toView(refund, refund.payment.order, { channelId: channel.id, channel }, metadata)];
        });
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

        const duplicateRefund = await this.connection
            .getRepository(ctx, Refund)
            .createQueryBuilder('refund')
            .where('LOWER(refund.transactionId) = :transactionId', {
                transactionId: `${REFUND_TRANSACTION_PREFIX}${transactionId}`,
            })
            .getOne();
        if (duplicateRefund) throw new UserInputError('该交易哈希已经登记过退款');
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
        refund: Refund,
        order: Order,
        intent: RefundChannelContext,
        metadata: ManualUsdtRefundMetadata,
    ): StoreUsdtManualRefundView {
        return {
            id: String(refund.id),
            channelId: String(intent.channelId),
            channelCode: intent.channel.code,
            paymentId: String(refund.paymentId),
            orderId: String(order.id),
            orderCode: order.code,
            currencyCode: String(order.currencyCode),
            amount: refund.total,
            usdtAmount: metadata.usdtAmount,
            network: metadata.network,
            transactionId: metadata.transactionId,
            blockNumber: metadata.blockNumber,
            reason: refund.reason ?? '',
            operatorUserId: metadata.operatorUserId,
            state: refund.state,
            createdAt: refund.createdAt,
        };
    }
}

function normalizeInput(input: StoreUsdtManualRefundInput): {
    amount: number;
    usdtAmount: string;
    transactionId: string;
    reason: string;
} {
    const amount = Number(input.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserInputError('退款金额必须大于 0');
    const usdtAmount = input.usdtAmount.trim();
    if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u.test(usdtAmount) || Number(usdtAmount) <= 0) {
        throw new UserInputError('实际退款 USDT 必须大于 0，且最多保留 6 位小数');
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
        transactionId,
        reason,
    };
}

function normalizeUsdtAmount(value: string): string {
    const [whole, fractional = ''] = value.split('.');
    return `${whole}.${fractional.padEnd(6, '0')}`;
}

function readManualRefundMetadata(metadata: unknown): ManualUsdtRefundMetadata | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const candidate = (metadata as Record<string, unknown>)[MANUAL_REFUND_METADATA_KEY];
    if (!candidate || typeof candidate !== 'object') return null;
    const value = candidate as Partial<ManualUsdtRefundMetadata>;
    if (
        typeof value.channelId !== 'string' ||
        typeof value.network !== 'string' ||
        typeof value.usdtAmount !== 'string' ||
        typeof value.transactionId !== 'string' ||
        !Number.isInteger(value.blockNumber) ||
        typeof value.operatorUserId !== 'string' ||
        typeof value.registeredAt !== 'string'
    ) {
        return null;
    }
    return value as ManualUsdtRefundMetadata;
}

function isLockUnsupported(error: unknown): boolean {
    return error instanceof Error && /Locking not supported|pessimistic lock/iu.test(error.message);
}

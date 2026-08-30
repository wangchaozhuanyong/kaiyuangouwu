import { Payment, Refund } from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { UsdtManualRefundService } from './usdt-manual-refund.service';

const inboundTransactionId = 'a'.repeat(64);
const refundTransactionId = 'b'.repeat(64);

describe('UsdtManualRefundService', () => {
    let payment: Payment;
    let intent: StorefrontUsdtPaymentIntent;
    let paymentRepository: ReturnType<typeof createPaymentRepository>;
    let intentRepository: ReturnType<typeof createIntentRepository>;
    let refundRepository: ReturnType<typeof createRefundRepository>;
    let orderService: {
        refundOrder: ReturnType<typeof vi.fn>;
        settleRefund: ReturnType<typeof vi.fn>;
    };
    let tronClient: { solidifiedTransaction: ReturnType<typeof vi.fn> };
    let service: UsdtManualRefundService;

    beforeEach(() => {
        const channel = { id: 'channel-1', code: 'store-one' } as any;
        const order = {
            id: 'order-1',
            code: 'ORDER-1',
            currencyCode: 'CNY',
            channels: [channel],
        } as any;
        payment = new Payment({
            id: 'payment-1',
            amount: 10_000,
            method: 'usdt-trc20',
            state: 'Settled',
            order,
            refunds: [],
        });
        intent = new StorefrontUsdtPaymentIntent({
            id: 'intent-1',
            channel,
            channelId: channel.id,
            order,
            orderId: order.id,
            paymentId: payment.id,
            status: 'SETTLED',
            transactionId: inboundTransactionId,
        });
        paymentRepository = createPaymentRepository(payment);
        intentRepository = createIntentRepository(intent);
        refundRepository = createRefundRepository();
        const pendingRefund = new Refund({
            id: 'refund-1',
            payment,
            paymentId: payment.id,
            total: 2_500,
            reason: '客户申请退款',
            state: 'Pending',
            metadata: {},
            createdAt: new Date('2026-08-29T10:00:00.000Z'),
        });
        orderService = {
            refundOrder: vi.fn().mockResolvedValue(pendingRefund),
            settleRefund: vi.fn().mockImplementation((_ctx, input) => {
                pendingRefund.state = 'Settled';
                pendingRefund.transactionId = input.transactionId;
                return Promise.resolve(pendingRefund);
            }),
        };
        tronClient = {
            solidifiedTransaction: vi.fn().mockResolvedValue({
                transactionId: refundTransactionId,
                blockNumber: 88_000_001,
            }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Payment) return paymentRepository;
                if (entity === Refund) return refundRepository;
                if (entity === StorefrontUsdtPaymentIntent) return intentRepository;
                throw new Error('Unexpected entity');
            }),
            withTransaction: vi.fn((ctx, work) => work(ctx)),
        };
        service = new UsdtManualRefundService(connection as any, orderService as any, tronClient as any);
    });

    it('creates and settles a Vendure refund with complete USDT audit metadata', async () => {
        const ctx = createContext();

        const result = await service.record(ctx, {
            paymentId: 'payment-1',
            amount: 2_500,
            usdtAmount: '3.25',
            transactionId: refundTransactionId.toUpperCase(),
            reason: ' 客户申请退款 ',
        });

        expect(tronClient.solidifiedTransaction).toHaveBeenCalledWith(refundTransactionId);
        expect(orderService.refundOrder).toHaveBeenCalledWith(ctx, {
            paymentId: 'payment-1',
            amount: 2_500,
            reason: '客户申请退款',
        });
        expect(orderService.settleRefund).toHaveBeenCalledWith(ctx, {
            id: 'refund-1',
            transactionId: `tron:${refundTransactionId}`,
        });
        expect(refundRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                state: 'Settled',
                metadata: {
                    manualUsdtRefund: expect.objectContaining({
                        channelId: 'channel-1',
                        usdtAmount: '3.250000',
                        transactionId: refundTransactionId,
                        blockNumber: 88_000_001,
                        operatorUserId: 'admin-1',
                    }),
                },
            }),
            { reload: false },
        );
        expect(result).toMatchObject({
            id: 'refund-1',
            channelId: 'channel-1',
            channelCode: 'store-one',
            orderCode: 'ORDER-1',
            amount: 2_500,
            usdtAmount: '3.250000',
            transactionId: refundTransactionId,
            state: 'Settled',
        });
    });

    it('rejects a merchant attempting to refund another Channel payment', async () => {
        await expect(
            service.record(createContext('channel-2'), {
                paymentId: 'payment-1',
                amount: 100,
                usdtAmount: '1',
                transactionId: refundTransactionId,
                reason: '退款测试',
            }),
        ).rejects.toThrow();

        expect(tronClient.solidifiedTransaction).not.toHaveBeenCalled();
        expect(orderService.refundOrder).not.toHaveBeenCalled();
    });

    it('rejects amounts above the remaining refundable balance', async () => {
        payment.refunds = [new Refund({ total: 4_000, state: 'Settled' })];

        await expect(
            service.record(createContext(), {
                paymentId: 'payment-1',
                amount: 6_001,
                usdtAmount: '8.5',
                transactionId: refundTransactionId,
                reason: '超过余额',
            }),
        ).rejects.toThrow('当前最多可退 60.00');

        expect(orderService.refundOrder).not.toHaveBeenCalled();
    });

    it('rejects an inbound payment hash and an unconfirmed refund hash', async () => {
        await expect(
            service.record(createContext(), {
                paymentId: 'payment-1',
                amount: 100,
                usdtAmount: '1',
                transactionId: inboundTransactionId,
                reason: '重复哈希',
            }),
        ).rejects.toThrow('不能与原收款交易哈希相同');

        tronClient.solidifiedTransaction.mockResolvedValue(null);
        await expect(
            service.record(createContext(), {
                paymentId: 'payment-1',
                amount: 100,
                usdtAmount: '1',
                transactionId: refundTransactionId,
                reason: '尚未确认',
            }),
        ).rejects.toThrow('尚未成功固化');
    });
});

function createContext(channelId = 'channel-1') {
    return {
        activeUserId: 'admin-1',
        channelId,
        userHasPermissions: vi.fn().mockReturnValue(false),
    } as any;
}

function createPaymentRepository(payment: Payment) {
    return {
        findOne: vi.fn().mockResolvedValue(payment),
        createQueryBuilder: vi.fn(() => chain({ getOne: vi.fn().mockResolvedValue(payment) })),
    };
}

function createIntentRepository(intent: StorefrontUsdtPaymentIntent) {
    return {
        findOne: vi
            .fn()
            .mockImplementation(({ where }) => Promise.resolve(where.transactionId ? null : intent)),
    };
}

function createRefundRepository() {
    return {
        save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        createQueryBuilder: vi.fn(() => chain({ getOne: vi.fn().mockResolvedValue(null) })),
    };
}

function chain(overrides: Record<string, unknown>) {
    const builder: Record<string, any> = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        ...overrides,
    };
    return builder;
}

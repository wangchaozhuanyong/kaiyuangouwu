import { Payment, Refund } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreUsdtManualRefund } from '../entities/store-usdt-manual-refund.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { UsdtManualRefundService } from './usdt-manual-refund.service';

const senderAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const recipientAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const inboundTransactionId = 'a'.repeat(64);
const refundTransactionId = 'b'.repeat(64);

describe('UsdtManualRefundService', () => {
    let payment: Payment;
    let intent: StorefrontUsdtPaymentIntent;
    let auditRepository: ReturnType<typeof createAuditRepository>;
    let refundRepository: ReturnType<typeof createRefundRepository>;
    let orderService: {
        refundOrder: ReturnType<typeof vi.fn>;
        settleRefund: ReturnType<typeof vi.fn>;
    };
    let tronClient: { solidifiedUsdtTransfer: ReturnType<typeof vi.fn> };
    let service: UsdtManualRefundService;

    beforeEach(() => {
        vi.stubEnv('USDT_REFUND_SENDER_ADDRESSES', senderAddress);
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
        auditRepository = createAuditRepository();
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
            settleRefund: vi.fn().mockImplementation(async (_ctx, input) => {
                pendingRefund.state = 'Settled';
                pendingRefund.transactionId = input.transactionId;
                return pendingRefund;
            }),
        };
        tronClient = {
            solidifiedUsdtTransfer: vi.fn().mockResolvedValue({
                transactionId: refundTransactionId,
                from: senderAddress,
                to: recipientAddress,
                amount: '3.250000',
                blockNumber: 88_000_001,
                blockTimestamp: new Date('2026-08-29T09:59:00.000Z'),
            }),
        };
        const paymentRepository = createPaymentRepository(payment);
        const intentRepository = createIntentRepository(intent);
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Payment) return paymentRepository;
                if (entity === Refund) return refundRepository;
                if (entity === StorefrontUsdtPaymentIntent) return intentRepository;
                if (entity === StoreUsdtManualRefund) return auditRepository;
                throw new Error(`Unexpected entity ${String(entity)}`);
            }),
            withTransaction: vi.fn((ctx, work) => work(ctx)),
        };
        service = new UsdtManualRefundService(connection as any, orderService as any, tronClient as any);
    });

    afterEach(() => vi.unstubAllEnvs());

    it('verifies the exact official transfer and stores a durable refund audit', async () => {
        const ctx = createContext();

        const result = await service.record(ctx, {
            paymentId: 'payment-1',
            amount: 2_500,
            usdtAmount: '3.25',
            recipientAddress,
            transactionId: refundTransactionId.toUpperCase(),
            reason: ' 客户申请退款 ',
        });

        expect(tronClient.solidifiedUsdtTransfer).toHaveBeenCalledWith(refundTransactionId);
        expect(orderService.refundOrder).toHaveBeenCalledWith(ctx, {
            paymentId: 'payment-1',
            amount: 2_500,
            reason: '客户申请退款',
        });
        expect(orderService.settleRefund).toHaveBeenCalledWith(ctx, {
            id: 'refund-1',
            transactionId: `tron:${refundTransactionId}`,
        });
        expect(auditRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                refundId: 'refund-1',
                usdtAmountBaseUnits: '3250000',
                transactionId: refundTransactionId,
                fromAddress: senderAddress,
                toAddress: recipientAddress,
                blockNumber: 88_000_001,
                operatorUserId: 'admin-1',
            }),
        );
        expect(result).toMatchObject({
            refundId: 'refund-1',
            channelId: 'channel-1',
            channelCode: 'store-one',
            orderCode: 'ORDER-1',
            amount: 2_500,
            usdtAmount: '3.250000',
            transactionId: refundTransactionId,
            fromAddress: senderAddress,
            toAddress: recipientAddress,
            state: 'Settled',
        });
    });

    it('rejects another Channel before calling the chain or refund services', async () => {
        await expect(service.record(createContext('channel-2'), validInput())).rejects.toThrow();

        expect(tronClient.solidifiedUsdtTransfer).not.toHaveBeenCalled();
        expect(orderService.refundOrder).not.toHaveBeenCalled();
    });

    it('rejects amounts above the remaining fiat refundable balance', async () => {
        payment.refunds = [new Refund({ total: 4_000, state: 'Settled' })];

        await expect(service.record(createContext(), { ...validInput(), amount: 6_001 })).rejects.toThrow(
            '当前最多可退 60.00',
        );

        expect(orderService.refundOrder).not.toHaveBeenCalled();
    });

    it('rejects a mismatched recipient, amount or sender from the chain receipt', async () => {
        tronClient.solidifiedUsdtTransfer.mockResolvedValueOnce({
            transactionId: refundTransactionId,
            from: senderAddress,
            to: recipientAddress,
            amount: '3.260000',
            blockNumber: 1,
            blockTimestamp: new Date(),
        });
        await expect(service.record(createContext(), validInput())).rejects.toThrow(
            '链上 USDT 数量为 3.260000',
        );

        tronClient.solidifiedUsdtTransfer.mockResolvedValueOnce({
            transactionId: refundTransactionId,
            from: senderAddress,
            to: senderAddress,
            amount: '3.250000',
            blockNumber: 1,
            blockTimestamp: new Date(),
        });
        await expect(service.record(createContext(), validInput())).rejects.toThrow(
            '链上收款地址与登记的客户退款地址不一致',
        );

        tronClient.solidifiedUsdtTransfer.mockResolvedValueOnce({
            transactionId: refundTransactionId,
            from: recipientAddress,
            to: recipientAddress,
            amount: '3.250000',
            blockNumber: 1,
            blockTimestamp: new Date(),
        });
        await expect(service.record(createContext(), validInput())).rejects.toThrow(
            '付款地址不在平台审核通过',
        );
        expect(orderService.refundOrder).not.toHaveBeenCalled();
    });

    it('rejects the inbound hash and a previously used refund hash', async () => {
        await expect(
            service.record(createContext(), {
                ...validInput(),
                transactionId: inboundTransactionId,
            }),
        ).rejects.toThrow('不能与原收款交易哈希相同');

        auditRepository.findOne.mockResolvedValueOnce({ id: 'existing-audit' } as any);
        await expect(service.record(createContext(), validInput())).rejects.toThrow('已经登记过退款');
    });

    it('returns Channel-scoped, date-filtered refund pages with a total count', async () => {
        auditRepository.findAndCount.mockResolvedValueOnce([[], 123]);

        const result = await service.listForChannel(createContext(), {
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-31T23:59:59.999Z',
            skip: 50,
            take: 500,
        });

        expect(auditRepository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channelId: 'channel-1' }),
                skip: 50,
                take: 100,
            }),
        );
        expect(result).toEqual({ items: [], totalItems: 123 });
    });
});

function validInput() {
    return {
        paymentId: 'payment-1',
        amount: 2_500,
        usdtAmount: '3.25',
        recipientAddress,
        transactionId: refundTransactionId,
        reason: '客户申请退款',
    };
}

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

function createAuditRepository() {
    return {
        findOne: vi.fn().mockResolvedValue(null),
        findAndCount: vi.fn().mockResolvedValue([[], 0]),
        save: vi.fn().mockImplementation((audit: StoreUsdtManualRefund) =>
            Promise.resolve(
                Object.assign(audit, {
                    id: 'audit-1',
                    createdAt: new Date('2026-08-29T10:00:00.000Z'),
                }),
            ),
        ),
    };
}

function createRefundRepository() {
    return {
        createQueryBuilder: vi.fn(() => chain({ getOne: vi.fn().mockResolvedValue(null) })),
    };
}

function chain(overrides: Record<string, unknown>) {
    return {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        ...overrides,
    } as Record<string, any>;
}

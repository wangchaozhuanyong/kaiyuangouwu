import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreUsdtManualRefund } from '../entities/store-usdt-manual-refund.entity';
import { StoreUsdtReconciliationAction } from '../entities/store-usdt-reconciliation-action.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import { UsdtPaymentService } from './usdt-payment.service';

const inboundTransactionId = 'a'.repeat(64);
const refundTransactionId = 'b'.repeat(64);
const customerRefundAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

function createHarness(manualReviewCode = 'order-validation-exception') {
    const intent = new StorefrontUsdtPaymentIntent({
        id: 'intent-1',
        channelId: 'channel-1',
        channel: { id: 'channel-1', code: 'store-one' },
        orderId: 'order-1',
        order: { id: 'order-1', code: 'ORDER-1' },
        quoteId: 'quote-1',
        quote: {
            id: 'quote-1',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 2_500,
            fiatPerUsdtRate: 7.6923,
            markupBps: 0,
            source: 'TEST',
        },
        paymentId: null,
        network: 'TRC20',
        tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
        receivingAddress: USDT_TRC20_CONTRACT_ADDRESS,
        receivingAddressFingerprint: 'fingerprint',
        matchKey: 'match-key',
        activeMatchKey: 'match-key',
        baseUsdtAmount: '3.250000',
        expectedUsdtAmount: '3.250000',
        receivedUsdtAmount: '3.250000',
        senderAddress: customerRefundAddress,
        status: 'MANUAL_REVIEW',
        transactionId: inboundTransactionId,
        blockNumber: 88_000_000,
        blockTimestamp: new Date('2026-09-20T10:00:00.000Z'),
        lastCheckedAt: new Date('2026-09-20T10:01:00.000Z'),
        settledAt: null,
        failureReason: '已确认到账，请人工复核',
        manualReviewCode,
        resolvedAt: null,
        resolvedByUserId: null,
        resolutionActionId: null,
        createdAt: new Date('2026-09-20T09:55:00.000Z'),
        expiresAt: new Date('2026-09-20T10:05:00.000Z'),
    });
    const intentRepository = {
        findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(where.id === intent.id ? intent : null),
        ),
        createQueryBuilder: vi.fn(() => ({
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(intent),
        })),
        save: vi.fn((value: StorefrontUsdtPaymentIntent) => Promise.resolve(value)),
        update: vi.fn((_where, values) => {
            Object.assign(intent, values, { status: 'SETTLED' });
            return Promise.resolve({ affected: 1 });
        }),
    };
    const actions: StoreUsdtReconciliationAction[] = [];
    const actionRepository = {
        find: vi.fn().mockResolvedValue(actions),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn((value: StoreUsdtReconciliationAction) => {
            value.id ??= `action-${actions.length + 1}`;
            value.createdAt ??= new Date('2026-09-20T10:10:00.000Z');
            value.updatedAt ??= value.createdAt;
            if (!actions.includes(value)) actions.push(value);
            return Promise.resolve(value);
        }),
    };
    const manualRefundRepository = { findOne: vi.fn().mockResolvedValue(null) };
    const connection = {
        getRepository: vi.fn((_ctx, target) => {
            if (target === StorefrontUsdtPaymentIntent) return intentRepository;
            if (target === StoreUsdtReconciliationAction) return actionRepository;
            if (target === StoreUsdtManualRefund) return manualRefundRepository;
            throw new Error(`Unexpected repository ${String(target)}`);
        }),
    };
    const tronClient = {
        solidifiedUsdtTransfer: vi.fn().mockImplementation((transactionId: string) =>
            Promise.resolve({
                transactionId,
                from:
                    transactionId === inboundTransactionId
                        ? customerRefundAddress
                        : USDT_TRC20_CONTRACT_ADDRESS,
                to:
                    transactionId === inboundTransactionId
                        ? USDT_TRC20_CONTRACT_ADDRESS
                        : customerRefundAddress,
                amount: '3.250000',
                blockNumber: transactionId === inboundTransactionId ? 88_000_000 : 88_000_100,
                blockTimestamp: new Date('2026-09-20T10:00:00.000Z'),
            }),
        ),
    };
    const service = new UsdtPaymentService(
        connection as never,
        {} as never,
        {} as never,
        {} as never,
        tronClient as never,
        { publish: vi.fn().mockResolvedValue(undefined) } as never,
    );
    return { actionRepository, actions, intent, service, tronClient };
}

describe('USDT reconciliation recovery', () => {
    beforeEach(() => vi.stubEnv('USDT_REFUND_SENDER_ADDRESSES', USDT_TRC20_CONTRACT_ADDRESS));
    afterEach(() => vi.unstubAllEnvs());

    it('retries only transient settlement exceptions and appends the outcome', async () => {
        const { actions, intent, service, tronClient } = createHarness();
        vi.spyOn(
            service as unknown as { settleMatchedIntent: () => Promise<'SETTLED'> },
            'settleMatchedIntent',
        ).mockResolvedValue('SETTLED');

        const result = await service.resolveManualReview({ activeUserId: 'admin-1' } as never, {
            id: intent.id,
            action: 'RETRY_SETTLEMENT',
            reason: '已复核链上证据，重试入账',
        });

        expect(tronClient.solidifiedUsdtTransfer).toHaveBeenCalledWith(inboundTransactionId);
        expect(result.status).toBe('SETTLED');
        expect(actions[0]).toMatchObject({
            action: 'RETRY_SETTLEMENT',
            outcome: 'SETTLED',
            operatorUserId: 'admin-1',
        });
        expect(intent).toMatchObject({
            resolvedByUserId: 'admin-1',
            resolutionActionId: 'action-1',
        });
    });

    it('rejects direct retry for ownership or wallet-integrity exceptions', async () => {
        const { intent, service, tronClient } = createHarness('reused-amount');
        await expect(
            service.resolveManualReview({ activeUserId: 'admin-1' } as never, {
                id: intent.id,
                action: 'RETRY_SETTLEMENT',
                reason: '尝试重试',
            }),
        ).rejects.toThrow('不能直接重试入账');
        expect(tronClient.solidifiedUsdtTransfer).not.toHaveBeenCalled();
    });

    it('rejects retry when the current chain block differs from the stored receipt snapshot', async () => {
        const { intent, service, tronClient } = createHarness();
        tronClient.solidifiedUsdtTransfer.mockResolvedValueOnce({
            transactionId: inboundTransactionId,
            from: customerRefundAddress,
            to: USDT_TRC20_CONTRACT_ADDRESS,
            amount: '3.250000',
            blockNumber: 88_000_001,
            blockTimestamp: new Date('2026-09-20T10:00:00.000Z'),
        });

        await expect(
            service.resolveManualReview({ activeUserId: 'admin-1' } as never, {
                id: intent.id,
                action: 'RETRY_SETTLEMENT',
                reason: '已复核链上证据，重试入账',
            }),
        ).rejects.toThrow('链上付款证据与已保存的到账快照不一致');
    });

    it('verifies a full external refund and closes the manual-review exception', async () => {
        const { actions, intent, service } = createHarness('reused-amount');
        const result = await service.resolveManualReview({ activeUserId: 'admin-1' } as never, {
            id: intent.id,
            action: 'CONFIRM_EXTERNAL_REFUND',
            reason: '已与客户确认地址并完成全额退款',
            transactionId: refundTransactionId,
            usdtAmount: '3.25',
            recipientAddress: customerRefundAddress,
        });

        expect(result.status).toBe('RESOLVED');
        expect(intent).toMatchObject({
            status: 'RESOLVED',
            activeMatchKey: null,
            resolvedByUserId: 'admin-1',
            resolutionActionId: 'action-1',
        });
        expect(actions[0]).toMatchObject({
            action: 'CONFIRM_EXTERNAL_REFUND',
            outcome: 'RESOLVED',
            transactionId: refundTransactionId,
            usdtAmountBaseUnits: '3250000',
            toAddress: customerRefundAddress,
        });
    });
});

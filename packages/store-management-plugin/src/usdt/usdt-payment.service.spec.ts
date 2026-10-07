import { Order, paymentHandlerArgumentsHash, PaymentMethod } from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { configureUsdtPaymentProofSecret, verifyUsdtPaymentProof } from './usdt-payment-proof';
import { USDT_TRC20_CONTRACT_ADDRESS, USDT_TRC20_PAYMENT_HANDLER_CODE } from './usdt-payment.constants';
import { createMatchKey, UsdtPaymentService } from './usdt-payment.service';
import { fingerprintReceivingAddress } from './usdt-wallet-configuration.service';

const receivingAddress = USDT_TRC20_CONTRACT_ADDRESS;
const receivingAddressFingerprint = fingerprintReceivingAddress(receivingAddress);
const wallet = {
    enabled: true as const,
    network: 'TRC20' as const,
    tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
    receivingAddress,
    receivingAddressFingerprint,
};

describe('UsdtPaymentService', () => {
    beforeEach(() => {
        configureUsdtPaymentProofSecret('unit-test-usdt-payment-service-secret-long-enough');
    });

    it('creates a server-bound intent with a unique six-decimal payment amount', async () => {
        const repository = {
            findOne: vi.fn().mockResolvedValue(null),
            manager: { connection: { options: { type: 'sqljs' } } },
            createQueryBuilder: vi.fn(),
        };
        let inserted: StorefrontUsdtPaymentIntent | null = null;
        const builder = {
            where: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            values: vi.fn(value => {
                inserted = Object.assign(value, { id: 'intent-1' });
                return builder;
            }),
            orIgnore: vi.fn().mockReturnThis(),
            updateEntity: vi.fn().mockReturnThis(),
            execute: vi.fn(),
            getOne: vi.fn(() => Promise.resolve(inserted)),
        };
        repository.createQueryBuilder.mockReturnValue(builder);
        const service = new UsdtPaymentService(
            {
                getRepository: (_ctx: any, entity: any) =>
                    entity === StorefrontUsdtPaymentIntent
                        ? repository
                        : {
                              findOne: vi.fn().mockResolvedValue({
                                  id: 'platform-method',
                                  code: 'usdt-trc20',
                                  enabled: true,
                                  handler: { code: USDT_TRC20_PAYMENT_HANDLER_CODE, args: [] },
                              }),
                          },
                getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'order-1', salesChannelId: 'channel-1' }),
            } as any,
            {
                withOrderMutationTransaction: vi.fn((ctx, work) => work(ctx)),
                lockOrderForRefund: vi.fn(),
            } as any,
            {} as any,
            { get: () => wallet, requireConfigured: () => wallet } as any,
            {} as any,
            {} as any,
            { assertNewRealPaymentAllowed: vi.fn().mockResolvedValue(undefined) } as any,
        );
        const quote = new StorefrontUsdtCheckoutQuote({
            id: 'quote-1',
            channelId: 'channel-1',
            orderId: 'order-1',
            usdtAmount: '13.850000',
            expiresAt: new Date(Date.now() + 600_000),
        });

        const intent = await service.ensureIntent({ channelId: 'channel-1' } as any, quote);

        expect(intent.expectedUsdtAmount).toMatch(/^13\.850\d{3}$/u);
        expect(Number(intent.expectedUsdtAmount)).toBeGreaterThan(13.85);
        expect(Number(intent.expectedUsdtAmount)).toBeLessThanOrEqual(13.850999);
        expect(intent).toMatchObject({
            receivingAddress,
            receivingAddressFingerprint,
            network: 'TRC20',
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            status: 'PENDING',
            acceptedHandlerSnapshot: expect.objectContaining({
                methodId: 'platform-method',
                handlerCode: USDT_TRC20_PAYMENT_HANDLER_CODE,
            }),
        });
    });

    it.each([
        'success',
        'validation-throws',
        'foreign-order',
        'foreign-quote',
        'wrong-payment',
        'invalidated-quote',
        'missing-snapshot',
        'unknown-snapshot',
        'changed-handler',
        'changed-args',
        'deleted-handler',
        'recreated-same-code',
    ] as const)('preserves verified transfer evidence when settlement outcome is %s', async outcome => {
        const now = new Date('2026-08-26T02:05:00.000Z');
        const intent = new StorefrontUsdtPaymentIntent({
            id: 'intent-1',
            channelId: 'channel-1',
            orderId: 'order-1',
            quoteId: 'quote-1',
            channel: { id: 'channel-1' },
            createdAt: new Date('2026-08-26T02:00:00.000Z'),
            expiresAt: new Date('2026-08-26T02:10:00.000Z'),
            expectedUsdtAmount: '13.850123',
            matchKey: createMatchKey('TRC20', receivingAddressFingerprint, '13.850123'),
            activeMatchKey: createMatchKey('TRC20', receivingAddressFingerprint, '13.850123'),
            network: 'TRC20',
            receivingAddress,
            receivingAddressFingerprint,
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            status: 'PENDING',
            acceptedHandlerSnapshot: {
                version: 1,
                methodId: 'platform-method',
                methodCode: 'usdt-trc20',
                handlerCode: USDT_TRC20_PAYMENT_HANDLER_CODE,
                argsHash: paymentHandlerArgumentsHash([]),
                acceptedAt: now.getTime(),
            },
        });
        if (outcome === 'missing-snapshot') intent.acceptedHandlerSnapshot = null;
        if (outcome === 'unknown-snapshot') {
            const snapshot = intent.acceptedHandlerSnapshot;
            if (!snapshot) throw new Error('Missing accepted handler snapshot in fixture');
            Object.assign(snapshot, { version: 2 });
        }
        if (outcome === 'invalidated-quote') {
            intent.status = 'EXPIRED';
            intent.failureReason = 'PAYMENT_CURRENCY_QUOTE_INVALIDATED:客户已切换为其他付款币种';
        }
        const intentRepository = {
            find: vi.fn().mockResolvedValueOnce([intent]).mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
            createQueryBuilder: () => ({
                setLock: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                getOne: vi.fn().mockResolvedValue(intent),
            }),
        };
        const paymentRepository = {
            findOne: vi
                .fn()
                .mockResolvedValue({ id: 'payment-1', order: { id: 'order-1' }, state: 'Settled' }),
        };
        const quote = new StorefrontUsdtCheckoutQuote({
            id: 'quote-1',
            channelId: 'channel-1',
            orderId: 'order-1',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 10_000,
        });
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StorefrontUsdtPaymentIntent
                    ? intentRepository
                    : entity === PaymentMethod
                      ? {
                            findOne: vi.fn().mockResolvedValue(
                                outcome === 'deleted-handler'
                                    ? null
                                    : {
                                          id:
                                              outcome === 'recreated-same-code'
                                                  ? 'replacement-method'
                                                  : 'platform-method',
                                          code: 'usdt-trc20',
                                          enabled: false,
                                          handler: {
                                              code:
                                                  outcome === 'changed-handler'
                                                      ? 'foreign-handler'
                                                      : USDT_TRC20_PAYMENT_HANDLER_CODE,
                                              args:
                                                  outcome === 'changed-args'
                                                      ? [{ name: 'destination', value: 'changed' }]
                                                      : [],
                                          },
                                      },
                            ),
                        }
                      : paymentRepository,
            ),
            getEntityOrThrow: vi.fn((_ctx, entity) =>
                Promise.resolve(
                    entity === Order
                        ? {
                              id: 'order-1',
                              salesChannelId: outcome === 'foreign-order' ? 'channel-2' : 'channel-1',
                          }
                        : quote,
                ),
            ),
            withTransaction: vi.fn((_ctx, work) => work({ channelId: 'channel-1' })),
        };
        const orderService = {
            withOrderMutationTransaction: vi.fn((ctx, work) => work(ctx)),
            lockOrderForRefund: vi.fn(() => Promise.resolve()),
            addPaymentToOrder: vi.fn(),
            addPaymentToOrderFromAcceptedIntent: vi
                .fn()
                .mockResolvedValue({ id: 'order-1', state: 'PaymentSettled' }),
        };
        if (outcome === 'validation-throws') {
            orderService.addPaymentToOrderFromAcceptedIntent.mockRejectedValue(
                new Error('Injected pricing failure'),
            );
        }
        const tronClient = {
            scanIncomingTransfers: vi.fn().mockResolvedValue({
                complete: true,
                transfers: [
                    {
                        transactionId: 'a'.repeat(64),
                        from: 'TSender',
                        to: receivingAddress,
                        amount: '13.850123',
                        blockTimestamp: now,
                    },
                ],
            }),
            solidifiedTransaction: vi.fn().mockResolvedValue({
                transactionId: 'a'.repeat(64),
                blockNumber: 85_700_193,
            }),
        };
        const service = new UsdtPaymentService(
            connection as any,
            orderService as any,
            { create: vi.fn().mockResolvedValue({ channelId: 'channel-1' }) } as any,
            { get: () => wallet, requireConfigured: () => wallet } as any,
            tronClient as any,
            { publish: vi.fn() } as any,
        );

        if (outcome === 'foreign-order')
            connection.getEntityOrThrow.mockImplementation((_ctx, entity) =>
                Promise.resolve(
                    entity === Order ? ({ id: 'order-1', salesChannelId: 'channel-2' } as any) : quote,
                ),
            );
        if (outcome === 'foreign-quote') quote.channelId = 'channel-2';
        if (outcome === 'wrong-payment')
            paymentRepository.findOne.mockResolvedValue({
                id: 'payment-1',
                order: { id: 'foreign-order' },
                state: 'Settled',
            });
        const result = await service.scanPendingPayments({} as any, now);

        expect(result).toMatchObject({
            settledCount: outcome === 'success' ? 1 : 0,
            manualReviewCount: outcome === 'success' ? 0 : 1,
        });
        expect(orderService.addPaymentToOrder).not.toHaveBeenCalled();
        if (
            [
                'foreign-order',
                'foreign-quote',
                'invalidated-quote',
                'missing-snapshot',
                'unknown-snapshot',
                'changed-handler',
                'changed-args',
                'deleted-handler',
                'recreated-same-code',
            ].includes(outcome)
        ) {
            expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
            expect(intent).toMatchObject({
                status: 'MANUAL_REVIEW',
                transactionId: 'a'.repeat(64),
                blockNumber: 85_700_193,
            });
            expect(intent.paymentId).toBeUndefined();
            return;
        }
        expect(intentRepository.save.mock.invocationCallOrder[0]).toBeLessThan(
            orderService.addPaymentToOrderFromAcceptedIntent.mock.invocationCallOrder[0],
        );
        expect(orderService.withOrderMutationTransaction.mock.calls.length).toBeGreaterThanOrEqual(2);
        const submitted = orderService.addPaymentToOrderFromAcceptedIntent.mock.calls[0] as unknown as [
            unknown,
            unknown,
            { proof: string },
        ];
        expect(verifyUsdtPaymentProof(submitted[2].proof)?.paidAt).toBe(now.getTime());
        expect(orderService.addPaymentToOrderFromAcceptedIntent).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'channel-1' }),
            expect.objectContaining({
                orderId: 'order-1',
                method: 'usdt-trc20',
                paymentMethodId: 'platform-method',
                handlerArgumentsHash: paymentHandlerArgumentsHash([]),
            }),
            expect.objectContaining({ proof: expect.any(String) }),
        );
        expect(intent).toMatchObject({
            status: outcome === 'success' ? 'SETTLED' : 'MANUAL_REVIEW',
            transactionId: 'a'.repeat(64),
            blockNumber: 85_700_193,
        });
        if (outcome === 'success') expect(intent.paymentId).toBe('payment-1');
        else expect(intent.paymentId).toBeUndefined();
    });

    it('expires older pending quotes without releasing their late-transfer match key', async () => {
        const intent = new StorefrontUsdtPaymentIntent({
            id: 'intent-1',
            orderId: 'order-1',
            quoteId: 'quote-1',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 600_000),
            activeMatchKey: 'TRC20:wallet:13.850123',
        });
        const intentRepository = {
            find: vi.fn().mockResolvedValue([intent]),
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        };
        const quoteRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
        const service = new UsdtPaymentService(
            {
                getRepository: vi.fn((_ctx, entity) =>
                    entity === StorefrontUsdtPaymentIntent ? intentRepository : quoteRepository,
                ),
            } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { assertNewRealPaymentAllowed: vi.fn().mockResolvedValue(undefined) } as any,
        );

        await expect(
            service.expirePendingIntentsForOrder({} as any, 'order-1', '订单金额已改变'),
        ).resolves.toBe(1);

        expect(intent).toMatchObject({
            status: 'EXPIRED',
            activeMatchKey: 'TRC20:wallet:13.850123',
        });
        expect(intent.failureReason).toContain('PAYMENT_CURRENCY_QUOTE_INVALIDATED:订单金额已改变');
        expect(quoteRepository.update).toHaveBeenCalledOnce();
    });

    it('raises a deduplicated P0 event for a solidified transfer with an unmatched amount', async () => {
        const now = new Date('2026-08-26T02:05:00.000Z');
        const intent = new StorefrontUsdtPaymentIntent({
            id: 'intent-1',
            channelId: 'channel-1',
            orderId: 'order-1',
            channel: { id: 'channel-1' },
            createdAt: new Date('2026-08-26T02:00:00.000Z'),
            expiresAt: new Date('2026-08-26T02:10:00.000Z'),
            expectedUsdtAmount: '13.850123',
            matchKey: createMatchKey('TRC20', receivingAddressFingerprint, '13.850123'),
            activeMatchKey: createMatchKey('TRC20', receivingAddressFingerprint, '13.850123'),
            receivingAddress,
            status: 'PENDING',
        });
        const intentRepository = {
            find: vi.fn().mockResolvedValueOnce([intent]).mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        };
        const transfer = {
            transactionId: 'b'.repeat(64),
            from: 'TSender',
            to: receivingAddress,
            amount: '13.000000',
            blockTimestamp: now,
        };
        const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
        const service = new UsdtPaymentService(
            { getRepository: () => intentRepository } as any,
            {} as any,
            {} as any,
            { get: () => wallet, requireConfigured: () => wallet } as any,
            {
                scanIncomingTransfers: vi.fn().mockResolvedValue({ complete: true, transfers: [transfer] }),
                solidifiedTransaction: vi.fn().mockResolvedValue({ blockNumber: 100 }),
            } as any,
            eventBus as any,
        );

        const result = await service.scanPendingPayments({ channelId: 'channel-1' } as any, now);

        expect(result).toMatchObject({ settledCount: 0, manualReviewCount: 0 });
        expect(eventBus.publish).toHaveBeenCalledOnce();
        const event = eventBus.publish.mock.calls[0][0];
        expect(event).toBeInstanceOf(AdminNotificationRequestedEvent);
        expect(event.notification).toMatchObject({
            eventType: 'commerce.payment.amount_mismatch',
            severity: 'P0',
            dedupKey: `commerce.payment.amount_mismatch:${transfer.transactionId}`,
        });
        expect(event.notification.payload).not.toHaveProperty('receivingAddress', receivingAddress);
    });
});

it('blocks preview intent creation and existing-intent reuse before loading wallets or allocating payment amounts', async () => {
    const repository = { findOne: vi.fn(), createQueryBuilder: vi.fn() };
    const wallets = { requireConfigured: vi.fn() };
    const service = new UsdtPaymentService(
        {
            getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'order', salesChannelId: 'store' }),
            getRepository: vi.fn().mockReturnValue(repository),
        } as any,
        {
            withOrderMutationTransaction: vi.fn((ctx, work) => work(ctx)),
            lockOrderForRefund: vi.fn(),
        } as any,
        {} as any,
        wallets as any,
        {} as any,
        {} as any,
        {
            assertNewRealPaymentAllowed: vi.fn().mockRejectedValue(new Error('公开预览禁止真实付款')),
        } as any,
    );
    await expect(
        service.ensureIntent(
            { channelId: 'store' } as any,
            {
                id: 'quote',
                channelId: 'store',
                orderId: 'order',
            } as any,
        ),
    ).rejects.toThrow('禁止真实付款');
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    expect(wallets.requireConfigured).not.toHaveBeenCalled();
});

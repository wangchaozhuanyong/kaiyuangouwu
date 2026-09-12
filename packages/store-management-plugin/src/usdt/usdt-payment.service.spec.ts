import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { configureUsdtPaymentProofSecret, verifyUsdtPaymentProof } from './usdt-payment-proof';
import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
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
            { getRepository: () => repository } as any,
            {} as any,
            {} as any,
            { get: () => wallet, requireConfigured: () => wallet } as any,
            {} as any,
            {} as any,
        );
        const quote = new StorefrontUsdtCheckoutQuote({
            id: 'quote-1',
            channelId: 'channel-1',
            orderId: 'order-1',
            usdtAmount: '13.850000',
            expiresAt: new Date(Date.now() + 600_000),
        });

        const intent = await service.ensureIntent({} as any, quote);

        expect(intent.expectedUsdtAmount).toMatch(/^13\.850\d{3}$/u);
        expect(Number(intent.expectedUsdtAmount)).toBeGreaterThan(13.85);
        expect(Number(intent.expectedUsdtAmount)).toBeLessThanOrEqual(13.850999);
        expect(intent).toMatchObject({
            receivingAddress,
            receivingAddressFingerprint,
            network: 'TRC20',
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            status: 'PENDING',
        });
    });

    it.each(['success', 'validation-throws'] as const)(
        'preserves verified transfer evidence when settlement outcome is %s',
        async outcome => {
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
            });
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
                findOne: vi.fn().mockResolvedValue({ id: 'payment-1', state: 'Settled' }),
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
                    entity === StorefrontUsdtPaymentIntent ? intentRepository : paymentRepository,
                ),
                getEntityOrThrow: vi.fn().mockResolvedValue(quote),
                withTransaction: vi.fn((_ctx, work) => work({ channelId: 'channel-1' })),
            };
            const orderService = {
                withOrderMutationTransaction: vi.fn((ctx, work) => work(ctx)),
                lockOrderForRefund: vi.fn(() => Promise.resolve()),
                addPaymentToOrder: vi.fn().mockResolvedValue({ id: 'order-1', state: 'PaymentSettled' }),
            };
            if (outcome === 'validation-throws') {
                orderService.addPaymentToOrder.mockRejectedValue(new Error('Injected pricing failure'));
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

            const result = await service.scanPendingPayments({} as any, now);

            expect(result).toMatchObject({
                settledCount: outcome === 'success' ? 1 : 0,
                manualReviewCount: outcome === 'success' ? 0 : 1,
            });
            expect(intentRepository.save.mock.invocationCallOrder[0]).toBeLessThan(
                orderService.addPaymentToOrder.mock.invocationCallOrder[0],
            );
            expect(orderService.withOrderMutationTransaction.mock.calls.length).toBeGreaterThanOrEqual(2);
            const submitted = orderService.addPaymentToOrder.mock.calls[0] as unknown as [
                unknown,
                unknown,
                { metadata: { proof: string } },
            ];
            expect(verifyUsdtPaymentProof(submitted[2].metadata.proof)?.paidAt).toBe(now.getTime());
            expect(orderService.addPaymentToOrder).toHaveBeenCalledWith(
                expect.objectContaining({ channelId: 'channel-1' }),
                'order-1',
                expect.objectContaining({ method: 'usdt-trc20' }),
            );
            expect(intent).toMatchObject({
                status: outcome === 'success' ? 'SETTLED' : 'MANUAL_REVIEW',
                transactionId: 'a'.repeat(64),
                blockNumber: 85_700_193,
            });
            if (outcome === 'success') expect(intent.paymentId).toBe('payment-1');
            else expect(intent.paymentId).toBeUndefined();
        },
    );

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

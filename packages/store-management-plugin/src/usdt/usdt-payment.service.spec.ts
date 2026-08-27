import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { configureUsdtPaymentProofSecret } from './usdt-payment-proof';
import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import { UsdtPaymentService } from './usdt-payment.service';
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
            save: vi.fn().mockImplementation(candidate => Promise.resolve({ id: 'intent-1', ...candidate })),
        };
        const service = new UsdtPaymentService(
            { getRepository: () => repository } as any,
            {} as any,
            {} as any,
            { get: () => wallet, requireConfigured: () => wallet } as any,
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
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            status: 'PENDING',
        });
    });

    it('settles only a solidified exact transfer and records the Vendure payment idempotently', async () => {
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
            receivingAddress,
            receivingAddressFingerprint,
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            status: 'PENDING',
        });
        const intentRepository = {
            find: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([intent]),
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
            addPaymentToOrder: vi.fn().mockResolvedValue({ id: 'order-1', state: 'PaymentSettled' }),
        };
        const tronClient = {
            incomingTransfers: vi.fn().mockResolvedValue([
                {
                    transactionId: 'a'.repeat(64),
                    from: 'TSender',
                    to: receivingAddress,
                    amount: '13.850123',
                    blockTimestamp: now,
                },
            ]),
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
        );

        const result = await service.scanPendingPayments({} as any, now);

        expect(result).toMatchObject({ settledCount: 1, manualReviewCount: 0 });
        expect(orderService.addPaymentToOrder).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'channel-1' }),
            'order-1',
            expect.objectContaining({ method: 'usdt-trc20' }),
        );
        expect(intent).toMatchObject({
            status: 'SETTLED',
            transactionId: 'a'.repeat(64),
            paymentId: 'payment-1',
            blockNumber: 85_700_193,
        });
    });
});

import { Payment, Refund } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { mergePaymentStats, StorePaymentReportingService } from './store-payment-reporting.service';

describe('StorePaymentReportingService', () => {
    it('combines settled payments and settled refunds into gross and net Channel totals', () => {
        const result = mergePaymentStats(
            [
                {
                    channelId: 1,
                    channelCode: 'store-one',
                    paymentMethodCode: 'card',
                    currencyCode: 'CNY',
                    settledCount: '3',
                    grossAmount: '12500',
                },
            ],
            [
                {
                    channelId: 1,
                    channelCode: 'store-one',
                    paymentMethodCode: 'card',
                    currencyCode: 'CNY',
                    refundCount: '1',
                    refundedAmount: '2500',
                },
            ],
        );

        expect(result).toEqual([
            {
                channelId: '1',
                channelCode: 'store-one',
                paymentMethodCode: 'card',
                currencyCode: 'CNY',
                settledCount: 3,
                refundCount: 1,
                grossAmount: 12500,
                refundedAmount: 2500,
                netAmount: 10000,
            },
        ]);
    });

    it('scopes payment and refund aggregates to the active merchant Channel', async () => {
        const paymentQuery = queryBuilder([
            {
                channelId: 'channel-1',
                channelCode: 'store-one',
                paymentMethodCode: 'card',
                currencyCode: 'MYR',
                settledCount: 1,
                grossAmount: 5000,
            },
        ]);
        const refundQuery = queryBuilder([]);
        const connection = {
            getRepository: vi.fn((_ctx, entity) => ({
                createQueryBuilder: vi.fn(() => (entity === Payment ? paymentQuery : refundQuery)),
            })),
        };
        const service = new StorePaymentReportingService(connection as any);

        const result = await service.statsForChannel({ channelId: 'channel-1' } as any);

        expect(connection.getRepository).toHaveBeenCalledWith(expect.anything(), Payment);
        expect(connection.getRepository).toHaveBeenCalledWith(expect.anything(), Refund);
        expect(paymentQuery.andWhere).toHaveBeenCalledWith('channel.id = :channelId', {
            channelId: 'channel-1',
        });
        expect(refundQuery.andWhere).toHaveBeenCalledWith('channel.id = :channelId', {
            channelId: 'channel-1',
        });
        expect(result[0]).toMatchObject({ grossAmount: 5000, refundedAmount: 0, netAmount: 5000 });
    });

    it('shows non-settled payments without counting them as collected money', async () => {
        const detailsQuery = queryBuilder([
            {
                paymentId: 'payment-1',
                channelId: 'channel-1',
                channelCode: 'store-one',
                orderId: 'order-1',
                orderCode: 'ORDER-1',
                paymentMethodCode: 'bank-transfer',
                paymentState: 'Authorized',
                currencyCode: 'CNY',
                amount: '9900',
                refundedAmount: '0',
                transactionId: null,
                createdAt: '2026-08-29T00:00:00.000Z',
            },
            {
                paymentId: 'payment-2',
                channelId: 'channel-1',
                channelCode: 'store-one',
                orderId: 'order-2',
                orderCode: 'ORDER-2',
                paymentMethodCode: 'card',
                paymentState: 'Settled',
                currencyCode: 'CNY',
                amount: '5000',
                refundedAmount: '500',
                transactionId: 'transaction-2',
                createdAt: '2026-08-29T01:00:00.000Z',
            },
        ]);
        const countQuery = queryBuilder([], 2);
        const createQueryBuilder = vi.fn().mockReturnValueOnce(detailsQuery).mockReturnValueOnce(countQuery);
        const connection = {
            getRepository: vi.fn(() => ({ createQueryBuilder })),
        };
        const service = new StorePaymentReportingService(connection as any);

        const result = await service.detailsForChannel({ channelId: 'channel-1' } as any, {
            from: new Date('2026-08-01T00:00:00.000Z'),
            to: new Date('2026-08-31T23:59:59.999Z'),
            skip: 50,
            take: 1000,
        });

        expect(detailsQuery.andWhere).toHaveBeenCalledWith('channel.id = :channelId', {
            channelId: 'channel-1',
        });
        expect(detailsQuery.andWhere).toHaveBeenCalledWith('payment.createdAt >= :reportFrom', {
            reportFrom: new Date('2026-08-01T00:00:00.000Z'),
        });
        expect(detailsQuery.orderBy).toHaveBeenCalledWith('payment.createdAt', 'DESC');
        expect(detailsQuery.addOrderBy).toHaveBeenCalledWith('payment.id', 'DESC');
        expect(detailsQuery.offset).toHaveBeenCalledWith(50);
        expect(detailsQuery.limit).toHaveBeenCalledWith(100);
        expect(result).toEqual({
            totalItems: 2,
            items: [
                expect.objectContaining({ id: 'payment-1', paymentState: 'Authorized', netAmount: 0 }),
                expect.objectContaining({ id: 'payment-2', paymentState: 'Settled', netAmount: 4500 }),
            ],
        });
    });
});

function queryBuilder(rows: unknown[], totalItems = rows.length) {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
        'innerJoin',
        'leftJoin',
        'select',
        'addSelect',
        'where',
        'andWhere',
        'groupBy',
        'addGroupBy',
        'orderBy',
        'addOrderBy',
        'offset',
        'limit',
    ]) {
        builder[method] = vi.fn(() => builder);
    }
    builder.getRawMany = vi.fn(() => Promise.resolve(rows));
    builder.getRawOne = vi.fn(() => Promise.resolve({ totalItems }));
    return builder;
}

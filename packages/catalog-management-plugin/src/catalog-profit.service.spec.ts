import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { calculateCatalogProfitReport, type ProfitOrderSource } from './catalog-profit.service';

const placedAt = new Date('2026-09-10T08:00:00.000Z');

function order(overrides: Partial<ProfitOrderSource> = {}): ProfitOrderSource {
    return {
        id: 'order-1',
        code: 'T-1001',
        orderPlacedAt: placedAt,
        currencyCode: CurrencyCode.MYR,
        shippingWithTax: 500,
        lines: [{ productVariantId: 'variant-1', quantity: 2 }],
        payments: [
            {
                method: 'card-payment',
                amount: 10_000,
                state: 'Settled',
                refunds: [{ total: 1_000, state: 'Settled' }],
            },
        ],
        ...overrides,
    };
}

describe('catalog profit report calculation', () => {
    it('subtracts settled refunds and historical product cost without double-counting shipping', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [{ effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 }],
                ],
            ]),
        );

        expect(result.summary).toMatchObject({
            orderCount: 1,
            quantity: 2,
            settledRevenueMicrounits: 100_000,
            refundedRevenueMicrounits: 10_000,
            netRevenueMicrounits: 90_000,
            shippingRevenueMicrounits: 5_000,
            productCostMicrounits: 40_000,
            grossProfitMicrounits: 50_000,
            grossMargin: 50_000 / 90_000,
            missingCostLineCount: 0,
            estimatedCostLineCount: 0,
            includesCarrierShippingCost: false,
            includesPaymentFees: false,
        });
    });

    it('does not publish a false profit when any order line has no cost', () => {
        const result = calculateCatalogProfitReport([order()], new Map());

        expect(result.summary.productCostMicrounits).toBeNull();
        expect(result.summary.grossProfitMicrounits).toBeNull();
        expect(result.summary.grossMargin).toBeNull();
        expect(result.summary.missingCostOrderCount).toBe(1);
        expect(result.items[0]).toMatchObject({
            productCostMicrounits: null,
            grossProfitMicrounits: null,
            missingCostLineCount: 1,
        });
    });

    it('marks a current cost used for an older order as an estimate', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [{ effectiveAt: new Date('2026-09-20T00:00:00.000Z'), costMicrounits: 25_000 }],
                ],
            ]),
        );

        expect(result.summary).toMatchObject({
            productCostMicrounits: 50_000,
            estimatedCostOrderCount: 1,
            estimatedCostLineCount: 1,
        });
    });

    it('ignores authorized payments until they are settled', () => {
        const result = calculateCatalogProfitReport(
            [order({ payments: [{ method: 'card-payment', amount: 10_000, state: 'Authorized' }] })],
            new Map(),
        );

        expect(result.summary.orderCount).toBe(0);
        expect(result.items).toEqual([]);
    });

    it.each([
        'production-coupon-atomicity-test',
        'dummy-payment',
        'MOCK_card',
        'sandbox',
        'demo',
        '测试支付',
    ])('excludes settled test payments identified by persisted method code: %s', method => {
        const result = calculateCatalogProfitReport(
            [order({ payments: [{ method, amount: 69_900, state: 'Settled' }] })],
            new Map(),
        );

        expect(result.items).toEqual([]);
        expect(result.summary).toMatchObject({
            orderCount: 0,
            settledRevenueMicrounits: 0,
            missingCostOrderCount: 0,
            missingPaymentFeeOrderCount: 0,
        });
    });

    it('excludes a neutral method name backed by a test handler', () => {
        const result = calculateCatalogProfitReport(
            [
                order({
                    payments: [
                        {
                            method: 'card',
                            handlerCode: 'dummy-payment-handler',
                            amount: 100,
                            state: 'Settled',
                        },
                    ],
                }),
            ],
            new Map(),
        );
        expect(result.items).toEqual([]);
    });

    it('keeps real payments and their refunds when an order also contains test payments', () => {
        const result = calculateCatalogProfitReport(
            [
                order({
                    payments: [
                        {
                            method: 'latest-card',
                            amount: 10_000,
                            state: 'Settled',
                            refunds: [{ total: 1_000, state: 'Settled' }],
                        },
                        {
                            method: 'sandbox-card',
                            amount: 69_900,
                            state: 'Settled',
                            refunds: [{ total: 69_900, state: 'Settled' }],
                        },
                    ],
                }),
            ],
            new Map(),
        );
        expect(result.summary).toMatchObject({
            orderCount: 1,
            settledRevenueMicrounits: 100_000,
            refundedRevenueMicrounits: 10_000,
            netRevenueMicrounits: 90_000,
            missingCostOrderCount: 1,
        });
    });

    it('subtracts actual carrier and payment expenses to produce net profit', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [{ effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 }],
                ],
            ]),
            new Map([['order-1', { carrierShippingCostMicrounits: 5_000, paymentFeeMicrounits: 2_000 }]]),
        );

        expect(result.summary).toMatchObject({
            grossProfitMicrounits: 50_000,
            carrierShippingCostMicrounits: 5_000,
            paymentFeeMicrounits: 2_000,
            netProfitMicrounits: 43_000,
            netMargin: 43_000 / 90_000,
            missingCarrierShippingCostOrderCount: 0,
            missingPaymentFeeOrderCount: 0,
            includesCarrierShippingCost: true,
            includesPaymentFees: true,
        });
    });

    it('does not publish net profit until both order expenses are explicitly recorded', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [{ effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 }],
                ],
            ]),
            new Map([['order-1', { carrierShippingCostMicrounits: 0, paymentFeeMicrounits: null }]]),
        );

        expect(result.summary).toMatchObject({
            carrierShippingCostMicrounits: 0,
            paymentFeeMicrounits: null,
            netProfitMicrounits: null,
            netMargin: null,
            missingCarrierShippingCostOrderCount: 0,
            missingPaymentFeeOrderCount: 1,
            includesCarrierShippingCost: true,
            includesPaymentFees: false,
        });
    });
});

import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import {
    calculateCatalogProfitReport,
    orderProfitExpenseApplicability,
    type ProfitOrderSource,
} from './catalog-profit.service';

const placedAt = new Date('2026-09-10T08:00:00.000Z');

function order(overrides: Partial<ProfitOrderSource> = {}): ProfitOrderSource {
    return {
        id: 'order-1',
        code: 'T-1001',
        orderPlacedAt: placedAt,
        currencyCode: CurrencyCode.MYR,
        total: 9_500,
        totalWithTax: 10_000,
        discountWithTax: 1_000,
        shippingWithTax: 500,
        lines: [
            {
                productVariantId: 'variant-1',
                quantity: 2,
                customFields: { fulfillmentTypeSnapshot: 'physical' },
            },
        ],
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
    const costs = new Map([
        ['variant-1', [{ effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 }]],
    ]);
    const digitalLine = {
        productVariantId: 'variant-1',
        quantity: 2,
        customFields: { fulfillmentTypeSnapshot: 'digital' },
    };

    it('calculates digital net profit without a logistics field, while leaving legacy expenses untouched', () => {
        const legacyExpense = {
            carrierShippingCostMicrounits: 9_000,
            paymentFeeMicrounits: 2_000,
            chargebackMicrounits: 0,
        };
        const result = calculateCatalogProfitReport(
            [order({ lines: [digitalLine] })],
            costs,
            new Map([['order-1', legacyExpense]]),
        );
        expect(result.items[0]).toMatchObject({
            fulfillmentType: 'DIGITAL',
            carrierShippingCostApplicable: false,
            carrierShippingCostMicrounits: null,
            netProfitMicrounits: 48_000,
        });
        expect(result.summary).toMatchObject({
            carrierShippingCostApplicable: false,
            carrierShippingCostMicrounits: null,
            missingCarrierShippingCostOrderCount: 0,
            netProfitMicrounits: 48_000,
        });
        expect(legacyExpense.carrierShippingCostMicrounits).toBe(9_000);
    });

    it('sums digital and physical orders using logistics only where applicable', () => {
        const result = calculateCatalogProfitReport(
            [order({ lines: [digitalLine] }), order({ id: 'order-2' })],
            costs,
            new Map([
                [
                    'order-1',
                    {
                        carrierShippingCostMicrounits: null,
                        paymentFeeMicrounits: 2000,
                        chargebackMicrounits: 0,
                    },
                ],
                [
                    'order-2',
                    { carrierShippingCostMicrounits: 5000, paymentFeeMicrounits: 0, chargebackMicrounits: 0 },
                ],
            ]),
        );
        expect(result.summary).toMatchObject({
            carrierShippingCostApplicable: true,
            carrierShippingCostMicrounits: 5000,
            missingCarrierShippingCostOrderCount: 0,
            netProfitMicrounits: 93_000,
        });
    });

    it('keeps an unknown payment fee unknown even when digital logistics is not applicable', () => {
        const result = calculateCatalogProfitReport(
            [order({ lines: [digitalLine] })],
            costs,
            new Map([
                [
                    'order-1',
                    {
                        carrierShippingCostMicrounits: null,
                        paymentFeeMicrounits: null,
                        chargebackMicrounits: 0,
                    },
                ],
            ]),
        );
        expect(result.summary).toMatchObject({
            missingCarrierShippingCostOrderCount: 0,
            missingPaymentFeeOrderCount: 1,
            paymentFeeMicrounits: null,
            netProfitMicrounits: null,
        });
    });

    it('requires logistics for a mixed order and for legacy lines with no reliable type', () => {
        const expenses = new Map([
            [
                'order-1',
                { carrierShippingCostMicrounits: null, paymentFeeMicrounits: 0, chargebackMicrounits: 0 },
            ],
        ]);
        for (const lines of [
            [digitalLine, { ...digitalLine, customFields: { fulfillmentTypeSnapshot: 'physical' } }],
            [{ productVariantId: 'variant-1', quantity: 2 }],
        ]) {
            const result = calculateCatalogProfitReport([order({ lines })], costs, expenses);
            expect(result.summary).toMatchObject({
                carrierShippingCostApplicable: true,
                missingCarrierShippingCostOrderCount: 1,
                netProfitMicrounits: null,
            });
        }
    });

    it('honours historical snapshots over changed product types, including cancelled line quantities', () => {
        const changedProduct = {
            ...digitalLine,
            quantity: 0,
            productVariant: { customFields: { fulfillmentType: 'physical' } },
        };
        expect(orderProfitExpenseApplicability({ lines: [changedProduct] })).toEqual({
            fulfillmentType: 'DIGITAL',
            carrierShippingCostApplicable: false,
        });
        const missingSnapshot = {
            customFields: {},
            productVariant: { customFields: { fulfillmentType: 'digital' } },
        };
        expect(orderProfitExpenseApplicability({ lines: [missingSnapshot] })).toEqual({
            fulfillmentType: 'UNKNOWN',
            carrierShippingCostApplicable: true,
        });
        expect(orderProfitExpenseApplicability({ lines: [] })).toEqual({
            fulfillmentType: 'UNKNOWN',
            carrierShippingCostApplicable: true,
        });
    });

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
            grossSalesMicrounits: 110_000,
            discountMicrounits: 10_000,
            taxMicrounits: 5_000,
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

    it.each([
        ['2026-09-10T08:00:00.000Z', 40_000, 0],
        ['2026-09-16T08:00:00.000Z', null, 1],
        ['2026-09-21T08:00:00.000Z', 0, 0],
    ])('uses the cost interval at order placement, including clears and zero: %s', (date, cost, missing) => {
        const result = calculateCatalogProfitReport(
            [order({ orderPlacedAt: new Date(date) })],
            new Map([
                [
                    'variant-1',
                    [
                        { effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 },
                        { effectiveAt: new Date('2026-09-15T00:00:00.000Z'), costMicrounits: null },
                        { effectiveAt: new Date('2026-09-20T00:00:00.000Z'), costMicrounits: 0 },
                    ],
                ],
            ]),
        );
        expect(result.items[0].productCostMicrounits).toBe(cost);
        expect(result.items[0].missingCostLineCount).toBe(missing);
        expect(result.items[0].estimatedCostLineCount).toBe(0);
        if (missing) expect(result.items[0].grossProfitMicrounits).toBeNull();
    });

    it('does not estimate an older order from a cleared current cost', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [
                        { effectiveAt: new Date('2026-09-20T00:00:00.000Z'), costMicrounits: 25_000 },
                        { effectiveAt: new Date('2026-09-21T00:00:00.000Z'), costMicrounits: null },
                    ],
                ],
            ]),
        );
        expect(result.items[0]).toMatchObject({
            productCostMicrounits: null,
            grossProfitMicrounits: null,
            missingCostLineCount: 1,
            estimatedCostLineCount: 0,
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
    ])('includes settled test payments identified by method code in profit reports: %s', method => {
        const result = calculateCatalogProfitReport(
            [order({ payments: [{ method, amount: 69_900, state: 'Settled' }] })],
            new Map(),
        );

        expect(result.summary).toMatchObject({
            orderCount: 1,
            settledRevenueMicrounits: 699_000,
            missingCostOrderCount: 1,
            missingPaymentFeeOrderCount: 1,
        });
    });

    it('keeps controlled checkout simulations out of realized profit', () => {
        const result = calculateCatalogProfitReport(
            [
                order({
                    payments: [{ method: 'controlled-test-payment-2', amount: 10_000, state: 'Settled' }],
                }),
            ],
            new Map(),
        );
        expect(result.summary.orderCount).toBe(0);
        expect(result.items).toEqual([]);
    });

    it('includes a neutral method name backed by a test handler', () => {
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
        expect(result.summary.orderCount).toBe(1);
        expect(result.summary.settledRevenueMicrounits).toBe(1_000);
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
            new Map([
                [
                    'order-1',
                    {
                        carrierShippingCostMicrounits: 5_000,
                        paymentFeeMicrounits: 2_000,
                        chargebackMicrounits: 3_000,
                    },
                ],
            ]),
        );

        expect(result.summary).toMatchObject({
            grossProfitMicrounits: 50_000,
            carrierShippingCostMicrounits: 5_000,
            paymentFeeMicrounits: 2_000,
            chargebackMicrounits: 3_000,
            netProfitMicrounits: 40_000,
            netMargin: 40_000 / 90_000,
            missingCarrierShippingCostOrderCount: 0,
            missingPaymentFeeOrderCount: 0,
            includesCarrierShippingCost: true,
            includesPaymentFees: true,
            includesChargebacks: true,
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
            new Map([
                [
                    'order-1',
                    {
                        carrierShippingCostMicrounits: 0,
                        paymentFeeMicrounits: null,
                        chargebackMicrounits: 0,
                    },
                ],
            ]),
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
            includesChargebacks: true,
        });
    });

    it('does not publish net profit until chargebacks are explicitly confirmed, including zero', () => {
        const result = calculateCatalogProfitReport(
            [order()],
            new Map([
                [
                    'variant-1',
                    [{ effectiveAt: new Date('2026-09-01T00:00:00.000Z'), costMicrounits: 20_000 }],
                ],
            ]),
            new Map([
                [
                    'order-1',
                    {
                        carrierShippingCostMicrounits: 0,
                        paymentFeeMicrounits: 0,
                        chargebackMicrounits: null,
                    },
                ],
            ]),
        );
        expect(result.summary).toMatchObject({
            chargebackMicrounits: null,
            missingChargebackOrderCount: 1,
            includesChargebacks: false,
            netProfitMicrounits: null,
        });
    });
});

import { describe, expect, it } from 'vitest';

import {
    physicalOrderQuantity,
    physicalOrderSubtotalWithTax,
    physicalSubtotalShippingCalculator,
    splitConfigurationList,
    supportedDestinationEligibilityChecker,
} from './commerce-shipping-options';

function line(type: 'physical' | 'digital', quantity: number, subtotal: number) {
    return {
        quantity,
        discountedLinePriceWithTax: subtotal,
        customFields: { fulfillmentTypeSnapshot: type },
        productVariant: { customFields: { fulfillmentType: type } },
    } as any;
}

const order = {
    lines: [line('physical', 2, 5_000), line('digital', 4, 20_000)],
    shippingAddress: { countryCode: 'MY', postalCode: '87000' },
} as any;

const calculatorArgs = [
    { name: 'baseRate', value: '1200' },
    { name: 'freeAbove', value: '10000' },
    { name: 'taxRate', value: '0' },
    { name: 'priceIncludesTax', value: 'false' },
    { name: 'estimateMinDays', value: '2' },
    { name: 'estimateMaxDays', value: '4' },
];

describe('physical shipping totals', () => {
    it('excludes digital lines from subtotal and quantity thresholds', () => {
        expect(physicalOrderSubtotalWithTax(order)).toBe(5_000);
        expect(physicalOrderQuantity(order)).toBe(2);
    });
});

describe('physicalSubtotalShippingCalculator', () => {
    it('charges the configured rate below the physical subtotal threshold', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            {} as any,
            order,
            calculatorArgs,
            {} as any,
        );

        expect(quote).toMatchObject({
            price: 1200,
            metadata: { physicalSubtotalWithTax: 5000, freeShippingApplied: false },
        });
    });

    it('applies free shipping only when physical products reach the threshold', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            {} as any,
            { ...order, lines: [line('physical', 1, 10_000), line('digital', 1, 1_000)] },
            calculatorArgs,
            {} as any,
        );

        expect(quote).toMatchObject({ price: 0, metadata: { freeShippingApplied: true } });
    });
});

describe('supportedDestinationEligibilityChecker', () => {
    it('accepts configured countries and rejects blocked postal prefixes', async () => {
        const args = [
            { name: 'allowedCountryCodes', value: 'MY, SG' },
            { name: 'blockedPostalPrefixes', value: '87, 91' },
        ];
        await supportedDestinationEligibilityChecker.init({ get: () => ({ get: () => null }) } as any);

        await expect(
            supportedDestinationEligibilityChecker.check(
                {} as any,
                { ...order, shippingAddress: { countryCode: 'MY', postalCode: '50000' } },
                args,
                {} as any,
            ),
        ).resolves.toBe(true);
        await expect(
            supportedDestinationEligibilityChecker.check({} as any, order, args, {} as any),
        ).resolves.toBe(false);
    });

    it('rejects digital-only orders because they do not need a shipping method', async () => {
        await supportedDestinationEligibilityChecker.init({ get: () => ({ get: () => null }) } as any);
        await expect(
            supportedDestinationEligibilityChecker.check(
                {} as any,
                { ...order, lines: [line('digital', 1, 1000)] },
                [
                    { name: 'allowedCountryCodes', value: 'MY' },
                    { name: 'blockedPostalPrefixes', value: '' },
                ],
                {} as any,
            ),
        ).resolves.toBe(false);
    });
});

describe('splitConfigurationList', () => {
    it('normalizes comma, semicolon and whitespace separated values', () => {
        expect(splitConfigurationList('my, sg; ID')).toEqual(['MY', 'SG', 'ID']);
    });
});

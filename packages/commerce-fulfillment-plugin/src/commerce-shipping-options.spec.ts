import { describe, expect, it } from 'vitest';

import {
    physicalOrderQuantity,
    physicalOrderSubtotalWithTax,
    physicalSubtotalShippingCalculator,
    splitConfigurationList,
    storeShippingZoneEligibilityChecker,
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
    { name: 'currencyCode', value: 'CNY' },
    { name: 'taxRate', value: '0' },
    { name: 'priceIncludesTax', value: 'false' },
    { name: 'estimateMinDays', value: '2' },
    { name: 'estimateMaxDays', value: '4' },
];

const ctx = {
    currencyCode: 'CNY',
    channel: { defaultCurrencyCode: 'CNY', customFields: {} },
} as any;

describe('physical shipping totals', () => {
    it('excludes digital lines from subtotal and quantity thresholds', () => {
        expect(physicalOrderSubtotalWithTax(order)).toBe(5_000);
        expect(physicalOrderQuantity(order)).toBe(2);
    });
});

describe('physicalSubtotalShippingCalculator', () => {
    it('charges the configured rate below the physical subtotal threshold', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(ctx, order, calculatorArgs, ctx);

        expect(quote).toMatchObject({
            price: 1200,
            metadata: { physicalSubtotalWithTax: 5000, freeShippingApplied: false },
        });
    });

    it('applies free shipping only when physical products reach the threshold', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            ctx,
            { ...order, lines: [line('physical', 1, 10_000), line('digital', 1, 1_000)] },
            calculatorArgs,
            ctx,
        );

        expect(quote).toMatchObject({ price: 0, metadata: { freeShippingApplied: true } });
    });

    it('converts the configured rate and threshold into the order currency', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            {
                currencyCode: 'MYR',
                channel: {
                    defaultCurrencyCode: 'CNY',
                    customFields: {
                        cnyToMyrRate: 0.6,
                        currencyRateMarkupBps: 0,
                        currencyRoundingMode: 'CENT',
                    },
                },
            } as any,
            order,
            calculatorArgs,
            {} as any,
        );

        expect(quote).toMatchObject({
            price: 720,
            metadata: { freeShippingThreshold: 6_000, freeShippingApplied: false },
        });
    });

    it('uses saved source currency even after default currency changes', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            {
                currencyCode: 'MYR',
                channel: {
                    defaultCurrencyCode: 'MYR',
                    customFields: {
                        cnyToMyrRate: 0.6,
                        currencyRateMarkupBps: 0,
                        currencyRoundingMode: 'CENT',
                    },
                },
            } as any,
            order,
            [
                ...calculatorArgs.filter(arg => arg.name !== 'currencyCode'),
                { name: 'currencyCode', value: 'MYR' },
                { name: 'sourceCurrencyCode', value: 'CNY' },
            ],
            {} as any,
        );
        expect(quote).toMatchObject({ price: 720, metadata: { freeShippingThreshold: 6000 } });
    });

    it('rejects shipping quotes without a supported exchange path or required rate', () => {
        const unsupported = { ...ctx, currencyCode: 'USD' };
        expect(() =>
            physicalSubtotalShippingCalculator.calculate(unsupported, order, calculatorArgs, unsupported),
        ).toThrow('运费币种汇率配置无效');
        const missingRate = { ...ctx, currencyCode: 'MYR' };
        expect(() =>
            physicalSubtotalShippingCalculator.calculate(missingRate, order, calculatorArgs, missingRate),
        ).toThrow('运费币种汇率配置无效');
    });

    it('uses discounted tax-inclusive physical subtotal instead of undiscounted or digital totals', async () => {
        const quote = await physicalSubtotalShippingCalculator.calculate(
            ctx,
            {
                ...order,
                lines: [{ ...line('physical', 1, 8000), linePriceWithTax: 20000 }, line('digital', 1, 50000)],
            },
            calculatorArgs,
            ctx,
        );
        expect(quote).toMatchObject({
            price: 1200,
            metadata: { physicalSubtotalWithTax: 8000, freeShippingApplied: false },
        });
    });
});

describe('storeShippingZoneEligibilityChecker', () => {
    const regionalContext = { channel: { defaultShippingZone: { id: 'store-zone' } } } as any;
    const regionalArgs = [
        { name: 'allowedCountryCodes', value: '' },
        { name: 'blockedPostalPrefixes', value: '' },
    ];
    const init = async (
        members = [
            { code: 'MY', enabled: true },
            { code: 'SG', enabled: false },
        ],
    ) => {
        await storeShippingZoneEligibilityChecker.init({
            get: () => ({ findOne: () => Promise.resolve({ id: 'store-zone', members }) }),
        } as any);
    };
    it('free shipping remains inside enabled countries of this store zone', async () => {
        await init();
        await expect(
            storeShippingZoneEligibilityChecker.check(regionalContext, order, regionalArgs, regionalContext),
        ).resolves.toBe(true);
        for (const countryCode of ['SG', 'US']) {
            await expect(
                storeShippingZoneEligibilityChecker.check(
                    regionalContext,
                    { ...order, shippingAddress: { countryCode } },
                    regionalArgs,
                    regionalContext,
                ),
            ).resolves.toBe(false);
        }
    });
    it('accepts legacy empty arguments only inside enabled countries of this store zone', async () => {
        await init();
        await expect(
            storeShippingZoneEligibilityChecker.check(regionalContext, order, [], regionalContext),
        ).resolves.toBe(true);
        for (const countryCode of ['SG', 'US']) {
            await expect(
                storeShippingZoneEligibilityChecker.check(
                    regionalContext,
                    { ...order, shippingAddress: { countryCode } },
                    [],
                    regionalContext,
                ),
            ).resolves.toBe(false);
        }
    });
    it('country restrictions narrow rather than broaden the store zone', async () => {
        await init();
        const args = [
            { name: 'allowedCountryCodes', value: 'MY,US' },
            { name: 'blockedPostalPrefixes', value: '87' },
        ];
        await expect(
            storeShippingZoneEligibilityChecker.check(regionalContext, order, args, regionalContext),
        ).resolves.toBe(false);
        await expect(
            storeShippingZoneEligibilityChecker.check(
                regionalContext,
                { ...order, shippingAddress: { countryCode: 'US' } },
                args,
                regionalContext,
            ),
        ).resolves.toBe(false);
    });
    it('requires a configured nonempty zone and physical goods', async () => {
        await init([]);
        await expect(
            storeShippingZoneEligibilityChecker.check(regionalContext, order, regionalArgs, regionalContext),
        ).resolves.toBe(false);
        await init();
        await expect(
            storeShippingZoneEligibilityChecker.check(
                { channel: {} } as any,
                order,
                regionalArgs,
                regionalContext,
            ),
        ).resolves.toBe(false);
        await expect(
            storeShippingZoneEligibilityChecker.check(
                regionalContext,
                { ...order, lines: [line('digital', 1, 8000)] },
                regionalArgs,
                regionalContext,
            ),
        ).resolves.toBe(false);
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

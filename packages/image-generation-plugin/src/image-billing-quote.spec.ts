import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { imagePricingSnapshot, quoteImageMoney } from './image-billing-quote';

describe('AI image billing quotes', () => {
    it('converts CNY model prices into the active MYR settlement currency', () => {
        const quote = quoteImageMoney(context(CurrencyCode.MYR), 1_000, CurrencyCode.CNY);

        expect(quote).toMatchObject({
            baseAmount: 1_000,
            baseCurrencyCode: CurrencyCode.CNY,
            amount: 612,
            currencyCode: CurrencyCode.MYR,
            cnyToMyrRate: 0.6,
            markupPercent: 2,
            roundingMode: 'CENT',
        });
        expect(imagePricingSnapshot(quote)).toMatchObject({
            settlementAmount: 612,
            settlementCurrencyCode: CurrencyCode.MYR,
        });
    });

    it('keeps same-currency prices exact without applying exchange markup', () => {
        expect(quoteImageMoney(context(CurrencyCode.CNY), 1_000, CurrencyCode.CNY)).toMatchObject({
            amount: 1_000,
            currencyCode: CurrencyCode.CNY,
            markupPercent: 0,
        });
    });

    it('fails closed when a requested cross-currency settlement is unsupported', () => {
        expect(() => quoteImageMoney(context(CurrencyCode.USD), 1_000, CurrencyCode.CNY)).toThrow(
            'AI 图片工坊暂不支持 USD 结算',
        );
    });

    it('fails closed when the managed exchange rate is not configured', () => {
        expect(() =>
            quoteImageMoney(
                { currencyCode: CurrencyCode.MYR, channel: { customFields: undefined } } as never,
                1_000,
                CurrencyCode.CNY,
            ),
        ).toThrow('CNY 兑 MYR 汇率不可用');
    });
});

function context(currencyCode: CurrencyCode) {
    return {
        currencyCode,
        channel: {
            customFields: {
                cnyToMyrRate: 0.6,
                currencyRateMarkupBps: 200,
                currencyRoundingMode: 'CENT',
                currencyRateUpdatedAt: new Date('2026-08-30T00:00:00.000Z'),
            },
        },
    } as never;
}

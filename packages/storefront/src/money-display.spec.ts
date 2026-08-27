import { afterEach, describe, expect, it } from 'vitest';

import {
    configureMoneyDisplay,
    convertMinorPriceToUsdt,
    formatDisplayMoney,
    resetMoneyDisplay,
} from './money-display';

afterEach(() => resetMoneyDisplay());

describe('USDT display money', () => {
    it('converts CNY minor units with the configured OTC rate and markup', () => {
        expect(
            convertMinorPriceToUsdt(10_000, 'CNY', {
                displayCurrencyCode: 'USDT',
                cnyPerUsdtRate: 7.2,
                myrPerUsdtRate: 4.32,
                usdtMarkupPercent: 1,
            }),
        ).toBeCloseTo(14.0278, 4);
    });

    it('converts MYR prices with the derived MYR/USDT rate', () => {
        expect(
            convertMinorPriceToUsdt(4_320, 'MYR', {
                displayCurrencyCode: 'USDT',
                cnyPerUsdtRate: 7.2,
                myrPerUsdtRate: 4.32,
                usdtMarkupPercent: 0,
            }),
        ).toBe(10);
    });

    it('formats an approximate USDT price but preserves fiat when USDT is not selected', () => {
        configureMoneyDisplay({
            displayCurrencyCode: 'USDT',
            cnyPerUsdtRate: 7.2,
            myrPerUsdtRate: 4.32,
            usdtMarkupPercent: 0,
        });
        expect(formatDisplayMoney(7_200, 'CNY', 'zh-CN')).toBe('≈₮10.00');

        resetMoneyDisplay();
        expect(formatDisplayMoney(7_200, 'CNY', 'zh-CN')).toContain('72');
    });
});

import { CurrencyCode } from '@vendure/core';

import { StoreCurrencyRoundingMode } from './types';

export function convertMinorPrice(
    price: number,
    baseCurrency: CurrencyCode,
    cnyToMyrRate: number,
    markupPercent: number,
    roundingMode: StoreCurrencyRoundingMode,
): number {
    const exchangeFactor = baseCurrency === CurrencyCode.CNY ? cnyToMyrRate : 1 / cnyToMyrRate;
    const raw = price * exchangeFactor * (1 + markupPercent / 100);
    const step = roundingMode === 'WHOLE' ? 100 : roundingMode === 'TENTH' ? 10 : 1;
    return Math.max(0, Math.round(raw / step) * step);
}

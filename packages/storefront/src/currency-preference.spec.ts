import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    readStoredCurrency,
    readStoredSettlementCurrency,
    writeStoredCurrency,
    writeStoredSettlementCurrency,
} from './storefront-utils';
import { MarketConfig } from './types';

const market: MarketConfig = {
    code: 'cn-mainland',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: '中国大陆',
};

afterEach(() => vi.unstubAllGlobals());

describe('display and settlement currency preferences', () => {
    it('keeps the backing fiat ledger currency when the customer selects USDT payment', () => {
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });

        writeStoredSettlementCurrency(market.code, 'MYR');
        writeStoredCurrency(market.code, 'USDT');

        expect(readStoredCurrency(market, ['CNY', 'MYR', 'USDT'])).toBe('USDT');
        expect(readStoredSettlementCurrency(market, ['CNY', 'MYR'])).toBe('MYR');
    });

    it('never stores USDT as the backing fiat ledger currency', () => {
        const setItem = vi.fn();
        vi.stubGlobal('localStorage', { getItem: () => null, setItem });

        writeStoredSettlementCurrency(market.code, 'USDT');

        expect(setItem).not.toHaveBeenCalled();
    });
});

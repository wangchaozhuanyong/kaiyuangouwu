import 'reflect-metadata';

import { CurrencyCode } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { convertMinorPrice } from './store-currency-settings.service';

describe('store currency price conversion', () => {
    it('converts CNY minor units to MYR minor units', () => {
        expect(convertMinorPrice(10_000, CurrencyCode.CNY, 0.5991, 0, 'CENT')).toBe(5_991);
        expect(convertMinorPrice(10_000, CurrencyCode.CNY, 0.5991, 0, 'TENTH')).toBe(5_990);
    });

    it('converts MYR back to CNY and applies the configured markup', () => {
        expect(convertMinorPrice(5_991, CurrencyCode.MYR, 0.5991, 0, 'CENT')).toBe(10_000);
        expect(convertMinorPrice(5_991, CurrencyCode.MYR, 0.5991, 2, 'WHOLE')).toBe(10_200);
    });

    it('never creates a negative price', () => {
        expect(convertMinorPrice(0, CurrencyCode.CNY, 0.5991, 10, 'CENT')).toBe(0);
    });
});

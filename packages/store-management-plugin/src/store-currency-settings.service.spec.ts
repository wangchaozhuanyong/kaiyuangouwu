import 'reflect-metadata';

import { CurrencyCode } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import {
    calculateUsdtCheckoutAmount,
    convertMinorPrice,
    getNextUsdtRateRefreshAt,
    getUsdtRateExpiresAt,
    isUsdtRateRefreshDue,
    publicCurrencySelection,
    StoreCurrencySettingsService,
    USDT_RATE_INTERVAL_OPTIONS,
} from './store-currency-settings.service';

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

describe('legacy currency price sync mutation', () => {
    it('does not materialize secondary-currency prices in manual mode', async () => {
        const service = Object.create(StoreCurrencySettingsService.prototype) as StoreCurrencySettingsService;
        const configuration = { rateMode: 'MANUAL' } as Awaited<
            ReturnType<StoreCurrencySettingsService['get']>
        >;
        vi.spyOn(service, 'get').mockResolvedValue(configuration);
        const refreshRate = vi.spyOn(service, 'refreshRate');

        await expect(service.syncPrices({} as never)).resolves.toBe(configuration);
        expect(refreshRate).not.toHaveBeenCalled();
    });

    it('only refreshes the rate in automatic mode', async () => {
        const service = Object.create(StoreCurrencySettingsService.prototype) as StoreCurrencySettingsService;
        const automatic = { rateMode: 'AUTO' } as Awaited<ReturnType<StoreCurrencySettingsService['get']>>;
        const refreshed = { rateMode: 'AUTO', cnyToMyrRate: 0.61 } as Awaited<
            ReturnType<StoreCurrencySettingsService['get']>
        >;
        vi.spyOn(service, 'get').mockResolvedValue(automatic);
        const refreshRate = vi.spyOn(service, 'refreshRate').mockResolvedValue(refreshed);

        await expect(service.syncPrices({} as never)).resolves.toBe(refreshed);
        expect(refreshRate).toHaveBeenCalledOnce();
    });
});

describe('USDT checkout quote amount', () => {
    it('applies markup and always rounds the payable amount up to four decimals', () => {
        expect(calculateUsdtCheckoutAmount(10_000, 7.2, 1)).toBe(14.0278);
    });

    it('rejects invalid rate inputs without producing an infinite amount', () => {
        expect(calculateUsdtCheckoutAmount(10_000, 0, 0)).toBe(0);
    });
});

describe('USDT rate collection schedule', () => {
    it('supports collecting once per hour', () => {
        expect(USDT_RATE_INTERVAL_OPTIONS).toContain(60);
        const hourlySchedule = {
            usdtRateScheduleMode: 'INTERVAL' as const,
            usdtRateIntervalMinutes: 60,
            usdtRateDailyTime: '10:00',
        };
        const updatedAt = new Date('2026-08-27T01:00:00.000Z');

        expect(isUsdtRateRefreshDue(hourlySchedule, updatedAt, new Date('2026-08-27T01:59:59.000Z'))).toBe(
            false,
        );
        expect(isUsdtRateRefreshDue(hourlySchedule, updatedAt, new Date('2026-08-27T02:00:00.000Z'))).toBe(
            true,
        );
    });

    const intervalSchedule = {
        usdtRateScheduleMode: 'INTERVAL' as const,
        usdtRateIntervalMinutes: 5,
        usdtRateDailyTime: '10:00',
    };
    const dailySchedule = {
        usdtRateScheduleMode: 'DAILY' as const,
        usdtRateIntervalMinutes: 5,
        usdtRateDailyTime: '10:00',
    };

    it('runs interval collection from the most recent successful update', () => {
        const updatedAt = new Date('2026-08-27T01:54:00.000Z');
        const beforeDue = new Date('2026-08-27T01:58:00.000Z');
        const dueAt = new Date('2026-08-27T01:59:00.000Z');

        expect(isUsdtRateRefreshDue(intervalSchedule, updatedAt, beforeDue)).toBe(false);
        expect(getNextUsdtRateRefreshAt(intervalSchedule, updatedAt, beforeDue)).toEqual(dueAt);
        expect(isUsdtRateRefreshDue(intervalSchedule, updatedAt, dueAt)).toBe(true);
        expect(getUsdtRateExpiresAt(intervalSchedule, updatedAt)).toEqual(
            new Date('2026-08-27T02:09:00.000Z'),
        );
    });

    it('runs daily collection at the configured Beijing time', () => {
        const previousUpdate = new Date('2026-08-26T02:01:00.000Z');
        const beforeDue = new Date('2026-08-27T01:59:00.000Z');
        const dueAt = new Date('2026-08-27T02:00:00.000Z');

        expect(isUsdtRateRefreshDue(dailySchedule, previousUpdate, beforeDue)).toBe(false);
        expect(getNextUsdtRateRefreshAt(dailySchedule, previousUpdate, beforeDue)).toEqual(dueAt);
        expect(isUsdtRateRefreshDue(dailySchedule, previousUpdate, dueAt)).toBe(true);
    });

    it('keeps a daily quote valid until fifteen minutes after the next planned collection', () => {
        expect(getUsdtRateExpiresAt(dailySchedule, new Date('2026-08-27T02:00:05.000Z'))).toEqual(
            new Date('2026-08-28T02:15:00.000Z'),
        );
    });
});

describe('public storefront currency selection', () => {
    it('preserves a channel currency outside the managed CNY and MYR pair', () => {
        expect(
            publicCurrencySelection({
                defaultCurrencyCode: CurrencyCode.USD,
                availableCurrencyCodes: [CurrencyCode.USD],
            }),
        ).toEqual({
            defaultCurrencyCode: CurrencyCode.USD,
            availableCurrencyCodes: [CurrencyCode.USD],
        });
    });

    it('deduplicates currencies and always includes the channel default', () => {
        expect(
            publicCurrencySelection({
                defaultCurrencyCode: CurrencyCode.MYR,
                availableCurrencyCodes: [CurrencyCode.CNY, CurrencyCode.CNY],
            }),
        ).toEqual({
            defaultCurrencyCode: CurrencyCode.MYR,
            availableCurrencyCodes: [CurrencyCode.MYR, CurrencyCode.CNY],
        });
    });
});

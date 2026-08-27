import 'reflect-metadata';

import type { Injector, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreCurrencySettingsService } from './store-currency-settings.service';
import {
    reconcileStoreUsdtPaymentsTask,
    refreshStoreUsdtRatesTask,
    syncAutomaticStoreCurrencyPricesTask,
} from './store-currency-tasks';
import { UsdtPaymentService } from './usdt/usdt-payment.service';

describe('automatic store currency task', () => {
    it('runs every day at 10:00 in the application business timezone', () => {
        expect(syncAutomaticStoreCurrencyPricesTask.options.schedule).toBe('0 10 * * *');
    });

    it('delegates all automatic channels to the currency service', async () => {
        const expected = [{ channelCode: 'cn-mainland', syncedPriceCount: 0, rate: 0.5991 }];
        const refreshAllAutomaticRates = vi.fn().mockResolvedValue(expected);
        const injector = {
            get: (token: unknown) => {
                expect(token).toBe(StoreCurrencySettingsService);
                return { refreshAllAutomaticRates };
            },
        } as Injector;
        const scheduledContext = {} as RequestContext;

        await expect(
            syncAutomaticStoreCurrencyPricesTask.options.execute({
                injector,
                scheduledContext,
                params: {},
            }),
        ).resolves.toEqual(expected);
        expect(refreshAllAutomaticRates).toHaveBeenCalledWith(scheduledContext);
    });
});

describe('automatic USDT rate task', () => {
    it('checks due per-Channel schedules every minute', () => {
        expect(refreshStoreUsdtRatesTask.options.schedule).toBe('* * * * *');
    });

    it('refreshes every channel with USDT display enabled', async () => {
        const expected = [{ channelCode: 'cn-mainland', syncedPriceCount: 8, rate: 7.2 }];
        const refreshAllEnabledUsdtRates = vi.fn().mockResolvedValue(expected);
        const injector = { get: () => ({ refreshAllEnabledUsdtRates }) } as unknown as Injector;
        const scheduledContext = {} as RequestContext;

        await expect(
            refreshStoreUsdtRatesTask.options.execute({ injector, scheduledContext, params: {} }),
        ).resolves.toEqual(expected);
        expect(refreshAllEnabledUsdtRates).toHaveBeenCalledWith(scheduledContext);
    });
});

describe('automatic USDT payment reconciliation task', () => {
    it('runs every minute and delegates to the chain-payment service', async () => {
        expect(reconcileStoreUsdtPaymentsTask.options.schedule).toBe('* * * * *');
        const expected = { configured: true, pendingIntentCount: 1, settledCount: 1 };
        const scanPendingPayments = vi.fn().mockResolvedValue(expected);
        const injector = {
            get: (token: unknown) => {
                expect(token).toBe(UsdtPaymentService);
                return { scanPendingPayments };
            },
        } as Injector;
        const scheduledContext = {} as RequestContext;

        await expect(
            reconcileStoreUsdtPaymentsTask.options.execute({ injector, scheduledContext, params: {} }),
        ).resolves.toEqual(expected);
        expect(scanPendingPayments).toHaveBeenCalledWith(scheduledContext);
    });
});

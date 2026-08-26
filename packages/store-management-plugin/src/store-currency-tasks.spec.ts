import 'reflect-metadata';

import type { Injector, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreCurrencySettingsService } from './store-currency-settings.service';
import { syncAutomaticStoreCurrencyPricesTask } from './store-currency-tasks';

describe('automatic store currency task', () => {
    it('runs every day at 10:00 in the application business timezone', () => {
        expect(syncAutomaticStoreCurrencyPricesTask.options.schedule).toBe('0 10 * * *');
    });

    it('delegates all automatic channels to the currency service', async () => {
        const expected = [{ channelCode: 'cn-mainland', syncedPriceCount: 88, rate: 0.5991 }];
        const syncAllAutomaticPrices = vi.fn().mockResolvedValue(expected);
        const injector = {
            get: (token: unknown) => {
                expect(token).toBe(StoreCurrencySettingsService);
                return { syncAllAutomaticPrices };
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
        expect(syncAllAutomaticPrices).toHaveBeenCalledWith(scheduledContext);
    });
});

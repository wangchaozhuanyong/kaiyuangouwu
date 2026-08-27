import { ScheduledTask } from '@vendure/core';

import { StoreCurrencySettingsService } from './store-currency-settings.service';
import { UsdtPaymentService } from './usdt/usdt-payment.service';

/**
 * The Vendure runtime sets TZ=Asia/Shanghai before the scheduler starts, so this
 * cron expression always represents 10:00 Beijing time in this application.
 */
export const syncAutomaticStoreCurrencyPricesTask = new ScheduledTask({
    id: 'sync-automatic-store-currency-prices',
    description: 'Refresh official CNY/MYR rates and sync converted prices at 10:00 Beijing time',
    schedule: '0 10 * * *',
    timeout: '10m',
    async execute({ injector, scheduledContext }) {
        return injector.get(StoreCurrencySettingsService).syncAllAutomaticPrices(scheduledContext);
    },
});

export const refreshStoreUsdtRatesTask = new ScheduledTask({
    id: 'refresh-store-usdt-rates',
    description: 'Refresh due per-Channel Binance and OKX P2P merchant USDT acquisition rates',
    schedule: '* * * * *',
    timeout: '2m',
    async execute({ injector, scheduledContext }) {
        return injector.get(StoreCurrencySettingsService).refreshAllEnabledUsdtRates(scheduledContext);
    },
});

export const reconcileStoreUsdtPaymentsTask = new ScheduledTask({
    id: 'reconcile-store-usdt-payments',
    description: 'Discover solidified USDT-TRC20 transfers and settle matching Vendure orders',
    schedule: '* * * * *',
    timeout: '2m',
    async execute({ injector, scheduledContext }) {
        return injector.get(UsdtPaymentService).scanPendingPayments(scheduledContext);
    },
});

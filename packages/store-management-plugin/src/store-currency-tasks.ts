import { ScheduledTask } from '@vendure/core';

import { StoreCurrencySettingsService } from './store-currency-settings.service';

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

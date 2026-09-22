import { ScheduledTask } from '@vendure/core';

import { MarketingAttributionService } from './marketing-attribution.service';

export const purgeExpiredMarketingAnalyticsTask = new ScheduledTask({
    id: 'purge-expired-marketing-analytics',
    description: 'Delete raw page-view attribution after its declared 90-day retention window',
    schedule: cron => cron.every(1).days(),
    execute({ injector, scheduledContext }) {
        return injector.get(MarketingAttributionService).purgeExpiredRawTraffic(scheduledContext);
    },
});

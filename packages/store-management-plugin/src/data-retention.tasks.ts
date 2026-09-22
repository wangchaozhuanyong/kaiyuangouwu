import { ScheduledTask } from '@vendure/core';

import { DataRetentionService } from './data-retention.service';

export const purgeDueDataRetentionTask = new ScheduledTask({
    id: 'purge-due-data-retention-records',
    description: 'Purge due quarantined data after reference and legal-hold checks',
    schedule: cron => cron.every(1).hours(),
    execute({ injector, scheduledContext }) {
        return injector.get(DataRetentionService).purgeDue(scheduledContext);
    },
});

import { ScheduledTask } from '@vendure/core';

import { AfterSalesEvidenceService } from './after-sales-evidence.service';

export const purgeAfterSalesEvidenceTask = new ScheduledTask({
    id: 'purge-after-sales-evidence',
    description:
        'Remove unsubmitted evidence after 24 hours and private evidence 180 days after case closure',
    schedule: cron => cron.every(1).hours(),
    execute: ({ injector }) => injector.get(AfterSalesEvidenceService).purgeExpired(),
});

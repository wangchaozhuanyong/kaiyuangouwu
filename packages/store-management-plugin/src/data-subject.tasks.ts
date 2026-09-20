import { ScheduledTask } from '@vendure/core';

import { DataSubjectService } from './data-subject.service';

export const processDueAccountClosuresTask = new ScheduledTask({
    id: 'process-due-account-closures',
    description: 'Process due account closures after cooling-off and business-blocker checks',
    schedule: cron => cron.every(1).hours(),
    execute({ injector, scheduledContext }) {
        return injector.get(DataSubjectService).processDue(scheduledContext);
    },
});

import { ScheduledTask } from '@vendure/core';

import { GovernanceService } from './governance.service';

export const generateGovernanceReportsTask = new ScheduledTask({
    id: 'generate-governance-control-reports',
    description: 'Generate governed control reports, verify the audit chain and alert on overdue reviews',
    schedule: cron => cron.every(1).hours(),
    execute({ injector }) {
        return injector.get(GovernanceService).generateDueReports();
    },
});

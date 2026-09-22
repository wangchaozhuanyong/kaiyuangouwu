import { Channel, RequestContextService, ScheduledTask, TransactionalConnection } from '@vendure/core';

import { FraudRiskService } from './fraud-risk.service';

export const reconcileFraudRiskCasesTask = new ScheduledTask({
    id: 'reconcile-fraud-risk-cases',
    description: 'Escalate overdue fraud-review and customer-appeal cases',
    schedule: cron => cron.every(1).hours(),
    async execute({ injector }) {
        const connection = injector.get(TransactionalConnection);
        const contexts = injector.get(RequestContextService);
        const fraud = injector.get(FraudRiskService);
        const channels = await connection.rawConnection.getRepository(Channel).find();
        let overdue = 0;
        for (const channel of channels) {
            const ctx = await contexts.create({ apiType: 'admin', channelOrToken: channel });
            overdue += await fraud.reconcileOverdue(ctx);
        }
        return { overdue };
    },
});

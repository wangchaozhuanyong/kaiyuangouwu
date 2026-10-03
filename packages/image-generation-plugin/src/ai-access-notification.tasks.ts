import { ScheduledTask } from '@vendure/core';

import { AiAccessNotificationService } from './ai-access-notification.service';
export const reconcileAiAccessTask = new ScheduledTask({
    id: 'reconcile-ai-access-notifications',
    description: '核验人工智能调用通道并合并服务告警',
    schedule: '* * * * *',
    timeout: '5m',
    async execute({ injector }) {
        await injector.get(AiAccessNotificationService).reconcile();
    },
});

import { ScheduledTask } from '@vendure/core';

import { ContentTranslationRetryService } from './content-translation-retry.service.js';

export const retryPendingContentTranslations = new ScheduledTask({
    id: 'retry-pending-content-translations',
    description: '补齐待翻译英文，保留管理员最新修改和人工英文',
    schedule: '* * * * *',
    timeout: '1m',
    execute: ({ injector }) => injector.get(ContentTranslationRetryService).retryPending(),
});

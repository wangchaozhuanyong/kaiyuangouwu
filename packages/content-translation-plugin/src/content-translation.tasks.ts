import { Channel, RequestContextService, ScheduledTask, TransactionalConnection } from '@vendure/core';

import { ContentTranslationBackfillService } from './content-translation-backfill.service.js';
import { ContentTranslationRetryService } from './content-translation-retry.service.js';
import { TranslationProviderState } from './entities/translation-provider-state.entity.js';
import { TranslationExecutionService } from './translation-execution.service.js';

export const retryPendingContentTranslations = new ScheduledTask({
    id: 'retry-pending-content-translations',
    description: '补齐待翻译英文，保留管理员最新修改和人工英文',
    schedule: '* * * * *',
    timeout: '1m',
    execute: ({ injector }) => injector.get(ContentTranslationRetryService).retryPending(),
});

export const enqueueHistoricalContentTranslations = new ScheduledTask({
    id: 'enqueue-historical-content-translations',
    description: '每分钟分批登记历史缺译内容，不在 API 启动时访问翻译服务',
    schedule: '* * * * *',
    timeout: '1m',
    execute: async ({ injector }) => {
        const execution = injector.get(TranslationExecutionService);
        const state = await execution.state();
        if (state.scanComplete) return { complete: true };
        const connection = injector.get(TransactionalConnection);
        const channels = await connection.rawConnection.getRepository(Channel).find({ order: { id: 'ASC' } });
        const channel = channels[state.scanChannelIndex];
        if (!channel) {
            await connection.rawConnection
                .getRepository(TranslationProviderState)
                .update(state.provider, { scanComplete: true });
            return { complete: true };
        }
        const ctx = await injector
            .get(RequestContextService)
            .create({ apiType: 'admin', channelOrToken: channel });
        const page = await injector
            .get(ContentTranslationBackfillService)
            .backfill(ctx, null, 100, state.scanOffset);
        await connection.rawConnection.getRepository(TranslationProviderState).update(state.provider, {
            scanOffset: page.hasMore ? page.nextOffset : 0,
            scanChannelIndex: page.hasMore ? state.scanChannelIndex : state.scanChannelIndex + 1,
        });
        return { scanned: page.scanned, queued: page.queued, channelId: channel.id };
    },
});

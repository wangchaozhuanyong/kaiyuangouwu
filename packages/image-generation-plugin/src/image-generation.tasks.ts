import { ScheduledTask } from '@vendure/core';

import { ImageGenerationQueueService } from './image-generation-queue.service';
import { ImageGenerationService } from './image-generation.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

export const reconcileImageGenerationsTask = new ScheduledTask({
    id: 'reconcile-image-generations',
    description:
        'Dispatch queued image outputs, reconcile unknown results, and repair interrupted wallet releases',
    schedule: cron => cron.every(1).minutes(),
    async execute({ injector }) {
        const [outputs, prompts] = await Promise.all([
            injector.get(ImageGenerationQueueService).reconcileUnknown(),
            injector.get(ImagePromptEngineService).recoverPendingOptimizations(),
        ]);
        return outputs + prompts;
    },
});

export const purgeExpiredPrivateImagesTask = new ScheduledTask({
    id: 'purge-expired-private-images',
    description: 'Delete expired private AI references and generated images',
    schedule: cron => cron.every(1).hours(),
    execute({ injector }) {
        return Promise.resolve(injector.get(ImagePrivateStorageService).purgeExpired());
    },
});

export const purgeImageGenerationSensitiveRecordsTask = new ScheduledTask({
    id: 'purge-image-generation-sensitive-records',
    description:
        'Verify long-term AI audit retention; compliance deletion uses a separately authorized workflow',
    schedule: cron => cron.every(1).days(),
    execute({ injector }) {
        return Promise.resolve(injector.get(ImageGenerationService).purgeSensitiveRecords());
    },
});

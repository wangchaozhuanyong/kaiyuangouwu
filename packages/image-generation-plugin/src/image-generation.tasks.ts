import { ScheduledTask } from '@vendure/core';

import { ImageGenerationQueueService } from './image-generation-queue.service';
import { ImageGenerationService } from './image-generation.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

export const reconcileImageGenerationsTask = new ScheduledTask({
    id: 'reconcile-image-generations',
    description:
        'Dispatch queued image outputs, reconcile unknown results, and repair interrupted wallet releases',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector }) {
        return injector.get(ImageGenerationQueueService).reconcileUnknown();
    },
});

export const purgeExpiredPrivateImagesTask = new ScheduledTask({
    id: 'purge-expired-private-images',
    description: 'Delete expired private AI references and generated images',
    schedule: cron => cron.every(1).hours(),
    async execute({ injector }) {
        return injector.get(ImagePrivateStorageService).purgeExpired();
    },
});

export const purgeImageGenerationSensitiveRecordsTask = new ScheduledTask({
    id: 'purge-image-generation-sensitive-records',
    description: 'Delete expired prompt optimization records and redact old generation prompts',
    schedule: cron => cron.every(1).days(),
    async execute({ injector }) {
        return injector.get(ImageGenerationService).purgeSensitiveRecords();
    },
});

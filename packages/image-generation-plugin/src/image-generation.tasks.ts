import { ScheduledTask } from '@vendure/core';

import { ImageGenerationQueueService } from './image-generation-queue.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

export const reconcileImageGenerationsTask = new ScheduledTask({
    id: 'reconcile-image-generations',
    description:
        'Reconcile unknown image results and any terminal output whose wallet release was interrupted',
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

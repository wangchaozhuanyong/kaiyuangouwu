import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus } from '@vendure/core';
import { BeforeAccountAnonymizationEvent } from '@vendure/store-management-plugin';

import { ImageGenerationService } from './image-generation.service';

@Injectable()
export class DataSubjectImageHandlerService implements OnApplicationBootstrap {
    constructor(
        private readonly events: EventBus,
        private readonly generations: ImageGenerationService,
    ) {}

    onApplicationBootstrap(): void {
        this.events.registerBlockingEventHandler({
            event: BeforeAccountAnonymizationEvent,
            id: 'image-generation-account-anonymization',
            handler: async event => {
                await this.generations.complianceAnonymizeCustomer(event.ctx, event.customerId, event.reason);
            },
        });
    }
}

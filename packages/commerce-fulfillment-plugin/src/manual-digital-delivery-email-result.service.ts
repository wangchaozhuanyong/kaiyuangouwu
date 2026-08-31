import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, Logger } from '@vendure/core';
import { EmailSendEvent } from '@vendure/email-plugin';
import { filter } from 'rxjs/operators';

import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';

@Injectable()
export class ManualDigitalDeliveryEmailResultService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly service: ManualDigitalDeliveryService,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus
            .ofType(EmailSendEvent)
            .pipe(
                filter(event => event.metadata?.type === 'manual-digital-delivery'),
                filter(event => typeof event.metadata?.deliveryId === 'string'),
            )
            .subscribe(event => {
                const id = event.metadata?.deliveryId;
                if (typeof id !== 'string') return;
                void this.service
                    .recordEmailResult(event.ctx, id, event.success, event.error)
                    .catch(error => {
                        Logger.error(
                            error instanceof Error ? error.message : String(error),
                            'ManualDigitalDelivery',
                        );
                    });
            });
    }
}

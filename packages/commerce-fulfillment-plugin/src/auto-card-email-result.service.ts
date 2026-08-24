import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, Logger } from '@vendure/core';
import { EmailSendEvent } from '@vendure/email-plugin';
import { filter } from 'rxjs/operators';

import { AutoCardService } from './auto-card.service';

const loggerCtx = 'AutoCardEmailResultService';

@Injectable()
export class AutoCardEmailResultService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly autoCardService: AutoCardService,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus
            .ofType(EmailSendEvent)
            .pipe(
                filter(event => event.metadata?.type === 'auto-card-delivery'),
                filter(event => typeof event.metadata?.deliveryId === 'string'),
            )
            .subscribe(event => {
                const deliveryId = event.metadata?.deliveryId;
                if (typeof deliveryId !== 'string') {
                    return;
                }
                void this.autoCardService
                    .recordEmailResult(event.ctx, deliveryId, event.success, event.error)
                    .catch(error => {
                        Logger.error(error instanceof Error ? error.message : String(error), loggerCtx);
                    });
            });
    }
}

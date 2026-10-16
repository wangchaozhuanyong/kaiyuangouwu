import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';

import { IcloudIdleService } from './icloud-idle.service';
import { IcloudMailEventsService } from './icloud-mail-events.service';

@Injectable()
export class IcloudMailHealthService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly idle: IcloudIdleService,
        private readonly events: IcloudMailEventsService,
    ) {}

    async read(ctx: RequestContext) {
        const [accounts, delivery] = await Promise.all([
            this.connection.getRepository(ctx, IcloudPrimaryAccount).find(),
            this.events.health(),
        ]);
        return {
            checkedAt: new Date(),
            listeners: accounts.map(account => this.idle.health(account)),
            delivery,
        };
    }
}

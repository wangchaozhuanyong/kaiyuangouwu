import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudAccountStatus } from '../types';

import { IcloudArrivalSampleService } from './icloud-arrival-sample.service';
import { IcloudIdleService } from './icloud-idle.service';
import { IcloudMailEventsService } from './icloud-mail-events.service';

@Injectable()
export class IcloudMailHealthService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly idle: IcloudIdleService,
        private readonly events: IcloudMailEventsService,
        private readonly arrival: IcloudArrivalSampleService,
    ) {}

    async read(ctx: RequestContext, sampleArrivalFor?: ID) {
        const [accounts, delivery] = await Promise.all([
            this.connection.getRepository(ctx, IcloudPrimaryAccount).find(),
            this.events.health(),
        ]);
        const listeners = accounts.map(account => this.idle.health(account));
        const sampleAccount =
            sampleArrivalFor != null && ctx.channel.code === DEFAULT_CHANNEL_CODE
                ? accounts.find(
                      account =>
                          String(account.id) === String(sampleArrivalFor) &&
                          account.status === IcloudAccountStatus.ACTIVE &&
                          account.lastSyncedUidValidity,
                  )
                : undefined;
        return {
            checkedAt: new Date(),
            listeners,
            delivery,
            arrivalSample: sampleAccount ? await this.arrival.read(ctx, sampleAccount) : null,
        };
    }
}

import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';

import { IcloudManagedMailboxClient } from './icloud-managed-mailbox.client';
import { IcloudPublicQueryService } from './icloud-public-query.service';

@Injectable()
export class IcloudUnifiedQueryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly local: IcloudPublicQueryService,
        private readonly managed: IcloudManagedMailboxClient,
    ) {}

    async queryByCode(ctx: RequestContext, rawCode: string, clientIp: string, userAgent?: string) {
        const code = rawCode.trim();
        if (this.managed.enabled && !/^(BUY|MSTR)-/i.test(code) && /^[A-Za-z0-9_-]{5,64}$/.test(code)) {
            // Custom local codes retain priority and all existing expiry/disabled/rate checks.
            const virtual = await this.connection.getRepository(ctx, IcloudVirtualEmail).findOne({
                where: { buyerQueryCode: code.toUpperCase() },
                select: ['id'],
            });
            const primary = virtual
                ? null
                : await this.connection.getRepository(ctx, IcloudPrimaryAccount).findOne({
                      where: { masterQueryCode: code.toUpperCase() },
                      select: ['id'],
                  });
            if (!virtual && !primary) return this.managed.query(code);
        }
        return this.local.queryByCode(ctx, code, clientIp, userAgent);
    }
}

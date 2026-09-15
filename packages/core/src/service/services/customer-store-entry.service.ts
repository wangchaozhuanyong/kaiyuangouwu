import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { CustomerStoreEntry } from '../../entity/customer-store-entry/customer-store-entry.entity';

@Injectable()
export class CustomerStoreEntryService {
    constructor(private readonly connection: TransactionalConnection) {}

    find(ctx: RequestContext, customerId: ID): Promise<CustomerStoreEntry | null> {
        return this.connection.getRepository(ctx, CustomerStoreEntry).findOne({
            where: { customerId, channelId: ctx.channelId },
        });
    }

    /** Called in the same transaction that creates a new canonical customer. */
    async recordRegistration(ctx: RequestContext, customerId: ID, verified: boolean): Promise<void> {
        await this.connection.getRepository(ctx, CustomerStoreEntry).insert({
            customerId,
            channelId: ctx.channelId,
            source: 'REGISTRATION',
            firstSeenAt: verified ? new Date() : null,
        });
    }

    /** Caller serializes membership changes on the Customer row inside the same transaction. */
    async recordAuthenticatedEntry(
        ctx: RequestContext,
        customerId: ID,
        alreadyMember: boolean,
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, CustomerStoreEntry);
        const query = repository
            .createQueryBuilder('entry')
            .where('entry.customerId = :customerId AND entry.channelId = :channelId', {
                customerId,
                channelId: ctx.channelId,
            });
        if (
            ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
                this.connection.rawConnection.options.type,
            )
        ) {
            query.setLock('pessimistic_write');
        }
        const entry = await query.getOne();
        if (entry) {
            if (entry.source === 'REGISTRATION' && entry.firstSeenAt == null) {
                await repository.update(entry.id, { firstSeenAt: new Date() });
            }
            return;
        }
        await repository.insert({
            customerId,
            channelId: ctx.channelId,
            source: alreadyMember ? 'LEGACY_UNRESOLVED' : 'AUTHENTICATED_ENTRY',
            firstSeenAt: alreadyMember ? null : new Date(),
        });
    }
}

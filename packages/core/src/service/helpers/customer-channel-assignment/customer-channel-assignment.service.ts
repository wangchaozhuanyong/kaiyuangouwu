import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { ForbiddenError } from '../../../common/error/errors';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Customer } from '../../../entity/customer/customer.entity';
import { ChannelService } from '../../services/channel.service';
import { CustomerStoreEntryService } from '../../services/customer-store-entry.service';
import { CustomerService } from '../../services/customer.service';

/**
 * @description
 * Handles the assignment of a signed-in Customer to the active Channel.
 *
 * @docsCategory services
 */
@Injectable()
export class CustomerChannelAssignmentService {
    constructor(
        private configService: ConfigService,
        private customerService: CustomerService,
        private channelService: ChannelService,
        private connection: TransactionalConnection,
        private storeEntryService: CustomerStoreEntryService,
    ) {}

    /**
     * @description
     * Assigns the active Customer to the active Channel where explicitly allowed. A Customer who
     * does not belong to the active Channel is denied when the strategy declines the assignment.
     */
    async tryAssignToActiveChannel(ctx: RequestContext): Promise<void> {
        const userId = ctx.activeUserId;
        if (!userId) {
            return;
        }
        const member = await this.customerService.findOneByUserId(ctx, userId, true);
        if (member) {
            const entry = await this.storeEntryService.find(ctx, member.id);
            if (entry && (entry.firstSeenAt != null || entry.source === 'LEGACY_UNRESOLVED')) return;
        }
        const customer = member ?? (await this.customerService.findOneByUserId(ctx, userId, false));
        if (!customer) return;
        await this.connection.withTransaction(ctx, async txCtx => {
            // Serialize first-entry recording with channel assignment, including concurrent tabs.
            const lock = this.connection
                .getRepository(txCtx, Customer)
                .createQueryBuilder('customer')
                .where('customer.id = :id', { id: customer.id });
            if (
                ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
                    this.connection.rawConnection.options.type,
                )
            ) {
                lock.setLock('pessimistic_write');
            }
            await lock.getOneOrFail();
            const membership = this.connection
                .getRepository(txCtx, Customer)
                .createQueryBuilder('customer')
                .innerJoin('customer.channels', 'channel', 'channel.id = :channelId', {
                    channelId: txCtx.channelId,
                })
                .where('customer.id = :id', { id: customer.id });
            if (
                ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
                    this.connection.rawConnection.options.type,
                )
            ) {
                membership.setLock('pessimistic_read');
            }
            const currentMember = await membership.getOne();
            if (!currentMember) {
                const { disableAuth, customerChannelAssignmentStrategy } = this.configService.authOptions;
                const canAssign =
                    disableAuth ||
                    (await customerChannelAssignmentStrategy.canAssignCustomerToChannel(
                        txCtx,
                        customer,
                        txCtx.channelId,
                    ));
                if (!canAssign) throw new ForbiddenError();
                await this.assignToActiveChannel(txCtx, customer.id);
            }
            await this.storeEntryService.recordAuthenticatedEntry(txCtx, customer.id, !!currentMember);
        });
    }

    private async assignToActiveChannel(ctx: RequestContext, customerId: ID): Promise<void> {
        try {
            await this.channelService.assignToChannels(ctx, Customer, customerId, [ctx.channelId]);
        } catch (e: any) {
            // Two requests for the same Customer can reach this at once and both try to add the same
            // Channel. If the database rejects ours as a duplicate, the other one already did the
            // work, so let it pass. Any other failure is real and should surface.
            // See https://github.com/vendurehq/vendure/issues/834
            const isDuplicateError =
                e.code === 'ER_DUP_ENTRY' /* MySQL/MariaDB */ || e.code === '23505'; /* Postgres */
            if (!isDuplicateError) {
                throw e;
            }
        }
    }
}

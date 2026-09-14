import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { ForbiddenError } from '../../../common/error/errors';
import { ConfigService } from '../../../config/config.service';
import { Customer } from '../../../entity/customer/customer.entity';
import { ChannelService } from '../../services/channel.service';
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
        const { disableAuth, customerChannelAssignmentStrategy } = this.configService.authOptions;

        if (!disableAuth) {
            const member = await this.customerService.findOneByUserId(ctx, userId, true);
            if (member) {
                return;
            }
        }

        // No Customer record (e.g. an Administrator) means there is nothing to assign.
        const customer = await this.customerService.findOneByUserId(ctx, userId, false);
        if (!customer) {
            return;
        }

        const canAssign =
            disableAuth ||
            (await customerChannelAssignmentStrategy.canAssignCustomerToChannel(
                ctx,
                customer,
                ctx.channelId,
            ));
        if (canAssign) {
            await this.assignToActiveChannel(ctx, customer.id);
        } else {
            throw new ForbiddenError();
        }
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

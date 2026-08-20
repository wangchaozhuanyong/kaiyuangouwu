import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    ForbiddenError,
    idsAreEqual,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { StoreProfile } from './entities/store-profile.entity';

@Injectable()
export class StorefrontActivationService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
    ) {}

    async assertActive(ctx: RequestContext): Promise<void> {
        if (ctx.apiType !== 'shop') return;
        const [channel, defaultChannel] = await Promise.all([
            this.channelService.findOne(ctx, ctx.channelId),
            this.channelService.getDefaultChannel(ctx),
        ]);
        if (channel?.sellerId && idsAreEqual(channel.sellerId, defaultChannel.sellerId)) {
            return;
        }
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId: ctx.channelId },
            select: { id: true, status: true },
        });
        // Merchant-owned Channels must fail closed. A missing profile can be
        // caused by partial provisioning and must never publish a storefront.
        if (profile?.status !== 'ACTIVE') {
            throw new ForbiddenError();
        }
    }
}

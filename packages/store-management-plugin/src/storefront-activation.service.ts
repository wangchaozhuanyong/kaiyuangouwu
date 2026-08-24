import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    ForbiddenError,
    idsAreEqual,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';

import { StoreProfile } from './entities/store-profile.entity';

export interface OperationalStorefrontInput {
    isDefaultChannel: boolean;
    status: StoreProfile['status'] | null;
    isPlatformOwned: boolean;
    hasVerifiedPrimaryDomain: boolean;
}

export function isOperationalStorefront(input: OperationalStorefrontInput): boolean {
    return (
        input.isDefaultChannel ||
        input.status === 'ACTIVE' ||
        (input.status === 'DRAFT' && input.isPlatformOwned && input.hasVerifiedPrimaryDomain)
    );
}

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
        const isDefaultChannel = Boolean(channel && idsAreEqual(channel.id, defaultChannel.id));
        if (isDefaultChannel) {
            return;
        }
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId: ctx.channelId },
            select: { id: true, status: true },
        });
        if (profile?.status === 'ACTIVE') {
            return;
        }

        const isPlatformOwnedDraft =
            profile?.status === 'DRAFT' &&
            Boolean(channel?.sellerId) &&
            idsAreEqual(channel?.sellerId, defaultChannel.sellerId);
        const hasVerifiedPrimaryDomain =
            isPlatformOwnedDraft &&
            (await this.connection.getRepository(ctx, StoreDomain).exists({
                where: {
                    channelId: ctx.channelId,
                    isPrimary: true,
                    status: 'ACTIVE',
                },
            }));
        if (
            isOperationalStorefront({
                isDefaultChannel,
                status: profile?.status ?? null,
                isPlatformOwned: isPlatformOwnedDraft,
                hasVerifiedPrimaryDomain,
            })
        ) {
            return;
        }

        // Merchant, suspended, unverified, and partially provisioned Channels
        // remain fail-closed. The narrow draft exception only preserves public
        // regional storefronts that are platform-owned and domain-verified.
        throw new ForbiddenError();
    }
}

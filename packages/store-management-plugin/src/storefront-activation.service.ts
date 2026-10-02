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
    isPublished: boolean;
    hasVerifiedPrimaryDomain: boolean;
}

export function isOperationalStorefront(input: OperationalStorefrontInput): boolean {
    return (
        !input.isDefaultChannel &&
        (input.status === 'ACTIVE' ||
            (input.status === 'DRAFT' &&
                (input.isPlatformOwned || input.isPublished) &&
                input.hasVerifiedPrimaryDomain))
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
            // Legacy account and historical order reads remain available. Catalog
            // access and starting new payments are blocked by their own guards.
            return;
        }
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId: ctx.channelId },
            select: { id: true, status: true, isPublished: true },
        });
        if (profile?.status === 'ACTIVE') {
            return;
        }

        const isPlatformOwnedDraft =
            profile?.status === 'DRAFT' &&
            Boolean(channel?.sellerId) &&
            idsAreEqual(channel?.sellerId, defaultChannel.sellerId);
        const hasVerifiedPrimaryDomain =
            profile?.status === 'DRAFT' &&
            (isPlatformOwnedDraft || profile.isPublished) &&
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
                isPublished: profile?.isPublished ?? false,
                hasVerifiedPrimaryDomain,
            })
        ) {
            return;
        }

        // Merchant drafts require an explicit public-preview setting and a verified
        // primary domain. Suspended and partially provisioned Channels stay closed.
        throw new ForbiddenError();
    }
}

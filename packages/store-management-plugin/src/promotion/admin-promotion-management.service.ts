import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ID,
    idsAreEqual,
    ListQueryBuilder,
    ListQueryOptions,
    Promotion,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, SelectQueryBuilder } from 'typeorm';

import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';

export interface AdminPromotionStore {
    id: ID;
    code: string;
    nameZh: string | null;
    nameEn: string | null;
}

export interface AdminPromotionManagementItem {
    promotion: Promotion;
    stores: AdminPromotionStore[];
    shared: boolean;
    ownershipKnown: boolean;
    archivedAt: Date | null;
    claimStartsAt: Date | null;
    claimEndsAt: Date | null;
}

/** Read-only metadata for the existing ReadPromotion/current-Channel scope. */
@Injectable()
export class AdminPromotionManagementService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly listQueryBuilder: ListQueryBuilder,
        private readonly translator: TranslatorService,
    ) {}

    async list(ctx: RequestContext, options: ListQueryOptions<Promotion> = {}, storeChannelId?: ID | null) {
        const platform = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        if (storeChannelId != null && !platform && !idsAreEqual(storeChannelId, ctx.channelId)) {
            throw new UserInputError('只能查询当前店铺的促销活动');
        }
        if (platform && storeChannelId != null && idsAreEqual(storeChannelId, ctx.channelId)) {
            throw new UserInputError('请选择经营店铺，默认 Channel 不是活动经营归属');
        }
        const selectedStoreId = platform ? storeChannelId : ctx.channelId;
        const pageQuery = this.query(ctx, options, true);
        if (selectedStoreId != null) this.filterStore(pageQuery, selectedStoreId);

        // The selector covers the complete read scope, independent of pagination and
        // the selected store. SQL projects distinct IDs instead of loading all activities.
        const directoryQuery = this.query(ctx, { ...options, skip: 0, take: 1 }, false);
        if (!platform) this.filterStore(directoryQuery, ctx.channelId);
        directoryQuery
            .leftJoin('management_config.channel', 'management_owner')
            .leftJoin(
                'promotion.channels',
                'management_store',
                'management_config.id IS NULL AND management_store.code != :defaultChannelCode',
            )
            .select('COALESCE(management_owner.id, management_store.id)', 'storeId')
            .distinct(true)
            .andWhere(
                '((management_config.id IS NOT NULL AND management_owner.code != :defaultChannelCode) ' +
                    'OR (management_config.id IS NULL AND management_store.id IS NOT NULL))',
            )
            .setParameter('defaultChannelCode', DEFAULT_CHANNEL_CODE)
            .skip(undefined)
            .take(undefined)
            .orderBy();
        if (!platform) {
            directoryQuery.andWhere(
                'COALESCE(management_owner.id, management_store.id) = :directoryStoreId',
                {
                    directoryStoreId: ctx.channelId,
                },
            );
        }
        const [[promotions, totalItems], storeRows] = await Promise.all([
            pageQuery.getManyAndCount(),
            directoryQuery.getRawMany<{ storeId: ID | null }>(),
        ]);
        const storeIds = [...new Set(storeRows.flatMap(row => (row.storeId == null ? [] : [row.storeId])))];
        const [channels, configs] = await Promise.all([
            storeIds.length
                ? this.connection
                      .getRepository(ctx, Channel)
                      .createQueryBuilder('store')
                      .select([
                          'store.id',
                          'store.code',
                          'store.customFields.storefrontNameZh',
                          'store.customFields.storefrontNameEn',
                      ])
                      .whereInIds(storeIds)
                      .andWhere('store.code != :defaultChannelCode', {
                          defaultChannelCode: DEFAULT_CHANNEL_CODE,
                      })
                      .orderBy('store.id', 'ASC')
                      .getMany()
                : [],
            promotions.length
                ? this.connection.getRepository(ctx, StoreCouponCampaignConfig).find({
                      where: { promotionId: In(promotions.map(promotion => promotion.id)) },
                  })
                : [],
        ]);
        const stores = channels.map(channel => {
            const fields = channel.customFields as { storefrontNameZh?: string; storefrontNameEn?: string };
            return {
                id: channel.id,
                code: channel.code,
                nameZh: fields?.storefrontNameZh?.trim() || null,
                nameEn: fields?.storefrontNameEn?.trim() || null,
            };
        });
        const byStore = new Map(stores.map(store => [String(store.id), store]));
        const byPromotion = new Map(configs.map(config => [String(config.promotionId), config]));
        const items: AdminPromotionManagementItem[] = promotions.map(promotion => {
            const config = byPromotion.get(String(promotion.id));
            const operatingChannels = promotion.channels.filter(
                channel => channel.code !== DEFAULT_CHANNEL_CODE,
            );
            const ownershipIds = config ? [config.channelId] : operatingChannels.map(channel => channel.id);
            const applicableStores = ownershipIds.flatMap(id => {
                const store = byStore.get(String(id));
                return store ? [store] : [];
            });
            return {
                promotion: this.translator.translate(promotion, ctx),
                stores: applicableStores,
                shared: !config && operatingChannels.length > 1,
                ownershipKnown: applicableStores.length > 0,
                archivedAt: config?.archivedAt ?? null,
                claimStartsAt: config?.claimStartsAt ?? null,
                claimEndsAt: config?.claimEndsAt ?? null,
            };
        });
        return { items, totalItems, stores };
    }

    private query(ctx: RequestContext, options: ListQueryOptions<Promotion>, includeRelations: boolean) {
        return this.listQueryBuilder
            .build(Promotion, options, {
                ctx,
                entityAlias: 'promotion',
                channelId: ctx.channelId,
                where: { deletedAt: IsNull() },
                relations: includeRelations ? ['translations', 'channels'] : [],
            })
            .leftJoin(
                StoreCouponCampaignConfig,
                'management_config',
                'management_config.promotionId = promotion.id',
            );
    }

    private filterStore(query: SelectQueryBuilder<Promotion>, storeChannelId: ID) {
        const membership = query
            .subQuery()
            .select('1')
            .from(Promotion, 'membership_promotion')
            .innerJoin('membership_promotion.channels', 'membership_store')
            .where('membership_promotion.id = promotion.id')
            .andWhere('membership_store.id = :managementStoreId')
            .andWhere('membership_store.code != :defaultChannelCode')
            .getQuery();
        // A configured coupon has one entitlement owner, even if its Promotion
        // has additional technical Channel memberships. Other promotions use memberships.
        query.andWhere(
            `(management_config.channelId = :managementStoreId OR ` +
                `(management_config.id IS NULL AND EXISTS ${membership}))`,
            { managementStoreId: storeChannelId, defaultChannelCode: DEFAULT_CHANNEL_CODE },
        );
    }
}

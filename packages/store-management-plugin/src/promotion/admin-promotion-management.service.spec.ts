import 'reflect-metadata';

import { SortOrder } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ConfigService,
    LanguageCode,
    ListQueryBuilder,
    Promotion,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';
import { PromotionTranslation } from '@vendure/core/dist/entity/promotion/promotion-translation.entity';
import { buildSchema, extendSchema, Kind, parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminApiExtensions } from '../api-extensions';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';

import { AdminPromotionManagementService } from './admin-promotion-management.service';

const channelFields = new EntitySchema({
    name: 'ManagementChannelFields',
    columns: {
        storefrontNameZh: { type: String, nullable: true },
        storefrontNameEn: { type: String, nullable: true },
    },
});
const channels = new EntitySchema<Channel>({
    name: 'Channel',
    target: Channel,
    columns: { id: { type: String, primary: true }, code: { type: String } },
    embeddeds: { customFields: { schema: channelFields } },
});
const translations = new EntitySchema<PromotionTranslation>({
    name: 'PromotionTranslation',
    target: PromotionTranslation,
    columns: {
        id: { type: Number, primary: true, generated: true },
        languageCode: { type: String },
        name: { type: String },
        description: { type: String },
    },
    relations: { base: { type: 'many-to-one', target: 'Promotion', inverseSide: 'translations' } },
});
const promotions = new EntitySchema<Promotion>({
    name: 'Promotion',
    target: Promotion,
    columns: {
        id: { type: String, primary: true },
        createdAt: { type: Date },
        updatedAt: { type: Date },
        deletedAt: { type: Date, nullable: true },
        startsAt: { type: Date, nullable: true },
        endsAt: { type: Date, nullable: true },
        enabled: { type: Boolean },
        couponCode: { type: String, nullable: true },
        conditions: { type: 'simple-json' },
        actions: { type: 'simple-json' },
    },
    relations: {
        channels: { type: 'many-to-many', target: 'Channel', joinTable: true },
        translations: { type: 'one-to-many', target: 'PromotionTranslation', inverseSide: 'base' },
    },
});
const couponConfigs = new EntitySchema<StoreCouponCampaignConfig>({
    name: 'StoreCouponCampaignConfig',
    target: StoreCouponCampaignConfig,
    columns: {
        id: { type: Number, primary: true, generated: true },
        promotionId: { type: String, unique: true },
        channelId: { type: String },
        archivedAt: { type: Date, nullable: true },
        claimStartsAt: { type: Date, nullable: true },
        claimEndsAt: { type: Date, nullable: true },
    },
    relations: {
        channel: { type: 'many-to-one', target: 'Channel', joinColumn: { name: 'channelId' } },
    },
});
const database = new DataSource({
    type: 'sqljs',
    entities: [channels, promotions, translations, couponConfigs],
    synchronize: true,
});
const platformContext = {
    apiType: 'admin',
    channelId: 'platform',
    languageCode: LanguageCode.zh_Hans,
    channel: { id: 'platform', code: '__default_channel__', defaultLanguageCode: LanguageCode.zh_Hans },
} as RequestContext;
const storeContext = {
    ...platformContext,
    channelId: 'a',
    channel: { id: 'a', code: 'store-a', defaultLanguageCode: LanguageCode.zh_Hans },
} as RequestContext;
const listOptions = { take: 20, sort: { createdAt: SortOrder.DESC, id: SortOrder.DESC } };
let service: AdminPromotionManagementService;

async function savePromotion(
    id: string,
    channelIds: string[],
    input: { couponCode?: string; deletedAt?: Date; enabled?: boolean } = {},
) {
    const promotion = await database.getRepository(Promotion).save({
        id,
        createdAt: new Date(id.startsWith('b-') ? '2026-10-02T00:00:00Z' : '2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        deletedAt: input.deletedAt ?? null,
        enabled: input.enabled ?? true,
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: new Date('2026-12-01T00:00:00Z'),
        couponCode: input.couponCode,
        conditions: [],
        actions: [],
        channels: channelIds.map(channelId => ({ id: channelId })),
    });
    await database.getRepository(PromotionTranslation).save([
        { languageCode: LanguageCode.zh_Hans, name: '同名活动', description: '中文活动', base: promotion },
        {
            languageCode: LanguageCode.en,
            name: 'Same campaign',
            description: 'English campaign',
            base: promotion,
        },
    ]);
}

beforeAll(async () => {
    await database.initialize();
    await database.getRepository(Channel).save([
        { id: 'platform', code: '__default_channel__', customFields: {} },
        {
            id: 'a',
            code: 'store-a',
            customFields: { storefrontNameZh: '店铺甲', storefrontNameEn: 'Store A' },
        },
        {
            id: 'b',
            code: 'store-b',
            customFields: { storefrontNameZh: '店铺乙', storefrontNameEn: 'Store B' },
        },
        {
            id: 'c',
            code: 'store-c',
            customFields: { storefrontNameZh: '范围外店铺', storefrontNameEn: 'Outside' },
        },
    ]);
    for (let index = 0; index < 101; index++) await savePromotion(`a-${index}`, ['platform', 'a']);
    for (let index = 0; index < 105; index++) await savePromotion(`b-${index}`, ['platform', 'b']);
    await savePromotion('shared', ['platform', 'a', 'b']);
    await savePromotion('legacy-coupon', ['platform', 'a', 'b'], { couponCode: 'LEGACY' });
    await savePromotion('owned-coupon', ['platform', 'a', 'b'], { couponCode: 'OWNED' });
    await savePromotion('archived-coupon', ['platform', 'a'], { couponCode: 'ARCHIVED' });
    await savePromotion('unknown', ['platform'], { enabled: false });
    await savePromotion('unknown-owner', ['platform', 'a', 'b'], { couponCode: 'UNKNOWN_OWNER' });
    await savePromotion('outside', ['c']);
    await savePromotion('deleted', ['platform', 'a'], { deletedAt: new Date('2026-10-05T00:00:00Z') });
    await database.getRepository(StoreCouponCampaignConfig).save([
        {
            promotionId: 'owned-coupon',
            channelId: 'b',
            claimStartsAt: null,
            claimEndsAt: new Date('2026-10-04T00:00:00Z'),
            archivedAt: null,
        },
        {
            promotionId: 'archived-coupon',
            channelId: 'a',
            claimStartsAt: new Date('2026-10-02T00:00:00Z'),
            claimEndsAt: new Date('2026-10-03T00:00:00Z'),
            archivedAt: new Date('2026-10-04T00:00:00Z'),
        },
        {
            promotionId: 'unknown-owner',
            channelId: 'platform',
            claimStartsAt: null,
            claimEndsAt: null,
            archivedAt: null,
        },
    ]);
    const connection = {
        rawConnection: database,
        getRepository: (_ctx: RequestContext, entity: typeof Promotion) => database.getRepository(entity),
    } as unknown as TransactionalConnection;
    const config = {
        defaultLanguageCode: LanguageCode.zh_Hans,
        customFields: {},
        apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 100 },
    } as ConfigService;
    service = new AdminPromotionManagementService(
        connection,
        new ListQueryBuilder(connection, config),
        new TranslatorService(config),
    );
});

afterAll(async () => {
    if (database.isInitialized) await database.destroy();
});

describe('admin promotion management with real scoped SQL and pagination', () => {
    it('merges the management contract with the existing core Promotion schema', () => {
        const promotionSchema = readFileSync(
            resolve(__dirname, '../../../core/src/api/schema/common/promotion.type.graphql'),
            'utf8',
        );
        const base = buildSchema(`
            scalar DateTime
            enum LanguageCode { en zh_Hans }
            interface Node { id: ID! }
            interface PaginatedList { totalItems: Int! }
            type ConfigurableOperationArg { name: String! value: String! }
            type ConfigurableOperation { code: String! args: [ConfigurableOperationArg!]! }
            input PromotionListOptions { skip: Int take: Int }
            type Query { promotions(options: PromotionListOptions): PromotionList! }
            ${promotionSchema}
        `);
        const types = adminApiExtensions.definitions.filter(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value.startsWith('AdminPromotion'),
        );
        const query = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION &&
                definition.name.value === 'Query' &&
                definition.fields?.some(candidate => candidate.name.value === 'adminPromotionManagement'),
        );
        if (query?.kind !== Kind.OBJECT_TYPE_EXTENSION) throw new Error('Missing admin Query extension');
        const field = query.fields?.find(item => item.name.value === 'adminPromotionManagement');
        if (!field) throw new Error('Missing promotion management query');
        expect(types).toHaveLength(3);
        const schema = extendSchema(base, {
            kind: Kind.DOCUMENT,
            definitions: [...types, { ...query, fields: [field] }],
        });
        const errors = validate(
            schema,
            parse(`query Management($options: PromotionListOptions, $storeChannelId: ID) {
                adminPromotionManagement(options: $options, storeChannelId: $storeChannelId) {
                    totalItems
                    stores { id code nameZh nameEn }
                    items {
                        promotion { id name enabled startsAt endsAt }
                        stores { id code nameZh nameEn }
                        shared ownershipKnown archivedAt claimStartsAt claimEndsAt
                    }
                }
            }`),
        );
        expect(errors).toEqual([]);
    });

    it('paginates more than 100 promotions without collapsing duplicate names or widening default membership', async () => {
        const first = await service.list(platformContext, { ...listOptions, take: 100 });
        const second = await service.list(platformContext, { ...listOptions, skip: 100, take: 100 });
        expect(first.totalItems).toBe(212);
        expect(second.totalItems).toBe(212);
        expect(first.items).toHaveLength(100);
        expect(second.items).toHaveLength(100);
        expect(new Set([...first.items, ...second.items].map(item => item.promotion.id)).size).toBe(200);
        expect(first.items.every(item => item.promotion.name === '同名活动')).toBe(true);
        expect(first.stores.map(store => store.id)).toEqual(['a', 'b']);
    });

    it('filters store ownership before pagination even beyond the first 100 global results', async () => {
        const first = await service.list(platformContext, { ...listOptions, take: 2 }, 'a');
        expect(first.totalItems).toBe(104);
        expect(first.items).toHaveLength(2);
        expect(first.items.every(item => item.stores.some(store => store.id === 'a'))).toBe(true);
        expect(first.stores.map(store => store.id)).toEqual(['a', 'b']);
        const tail = await service.list(platformContext, { ...listOptions, skip: 100, take: 20 }, 'a');
        expect(tail.items).toHaveLength(4);
        expect(tail.totalItems).toBe(104);
        const b = await service.list(platformContext, listOptions, 'b');
        expect(b.totalItems).toBe(108);
    });

    it('uses the coupon configuration owner rather than treating additional memberships as shared ownership', async () => {
        const options = { ...listOptions, filter: { id: { eq: 'owned-coupon' } } };
        const result = await service.list(platformContext, options);
        expect(result.items[0]).toMatchObject({
            stores: [{ id: 'b', nameZh: '店铺乙', nameEn: 'Store B' }],
            ownershipKnown: true,
            shared: false,
            archivedAt: null,
            claimEndsAt: new Date('2026-10-04T00:00:00Z'),
            promotion: { enabled: true, endsAt: new Date('2026-12-01T00:00:00Z') },
        });
        expect((await service.list(platformContext, options, 'a')).totalItems).toBe(0);
        expect((await service.list(platformContext, options, 'b')).totalItems).toBe(1);
    });

    it('returns lifecycle metadata without changing the promotion or coupon configuration', async () => {
        const before = await database.getRepository(StoreCouponCampaignConfig).find();
        const result = await service.list(platformContext, {
            ...listOptions,
            filter: { id: { eq: 'archived-coupon' } },
        });
        expect(result.items[0]).toMatchObject({
            archivedAt: new Date('2026-10-04T00:00:00Z'),
            claimStartsAt: new Date('2026-10-02T00:00:00Z'),
            claimEndsAt: new Date('2026-10-03T00:00:00Z'),
            promotion: { enabled: true, endsAt: new Date('2026-12-01T00:00:00Z') },
        });
        expect(await database.getRepository(StoreCouponCampaignConfig).find()).toEqual(before);
    });

    it('marks default-only promotions as unknown without inventing an operating owner', async () => {
        const result = await service.list(platformContext, {
            ...listOptions,
            filter: { id: { eq: 'unknown' } },
        });
        expect(result.items[0]).toMatchObject({ stores: [], ownershipKnown: false, shared: false });
        expect(result.stores).toEqual([]);
        await expect(service.list(platformContext, listOptions, 'platform')).rejects.toBeInstanceOf(
            UserInputError,
        );
    });

    it.each(['shared', 'legacy-coupon'])(
        'excludes the default technical association from shared %s applicability',
        async id => {
            const result = await service.list(platformContext, {
                ...listOptions,
                filter: { id: { eq: id } },
            });
            expect(result.items[0]).toMatchObject({ ownershipKnown: true, shared: true });
            expect(result.items[0]?.stores.map(store => store.id)).toEqual(['a', 'b']);
            expect(result.items[0]?.claimStartsAt).toBeNull();
            expect(result.items[0]?.claimEndsAt).toBeNull();
        },
    );

    it('does not fall back to memberships when a configured coupon has no operating owner', async () => {
        const options = { ...listOptions, filter: { id: { eq: 'unknown-owner' } } };
        const result = await service.list(platformContext, options);
        expect(result.items[0]).toMatchObject({ stores: [], ownershipKnown: false, shared: false });
        expect(result.stores).toEqual([]);
        expect((await service.list(platformContext, options, 'a')).totalItems).toBe(0);
        expect((await service.list(platformContext, options, 'b')).totalItems).toBe(0);
    });

    it('keeps merchant records and store metadata inside the current operating scope', async () => {
        const result = await service.list(storeContext, { ...listOptions, take: 100 });
        expect(result.totalItems).toBe(104);
        expect(result.stores.map(store => store.id)).toEqual(['a']);
        expect(result.items.every(item => item.stores.every(store => store.id === 'a'))).toBe(true);
        expect(result.items.some(item => item.promotion.id === 'owned-coupon')).toBe(false);
        await expect(service.list(storeContext, listOptions, 'b')).rejects.toBeInstanceOf(UserInputError);
        await expect(service.list(storeContext, listOptions, 'platform')).rejects.toBeInstanceOf(
            UserInputError,
        );
    });

    it('preserves native list filtering and localized names in the new read projection', async () => {
        const result = await service.list(
            { ...platformContext, languageCode: LanguageCode.en } as RequestContext,
            { ...listOptions, filter: { enabled: { eq: false } } },
        );
        expect(result.totalItems).toBe(1);
        expect(result.items[0]?.promotion.name).toBe('Same campaign');
    });
});

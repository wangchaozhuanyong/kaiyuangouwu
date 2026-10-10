import 'reflect-metadata';

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
    Channel,
    Collection,
    CollectionTranslation,
    LanguageCode,
    Product,
    ProductTranslation,
    type Permission,
    type RequestContext,
    type TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import type { StorefrontPageData } from '@vendure/storefront-content-plugin';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontPublicSeoService } from './storefront-public-seo.service';
import {
    defaultStorefrontSeoSettings,
    storefrontSeoSettingsIdentity,
    type StorefrontSeoIdentity,
} from './storefront-seo.contract';
import { StorefrontSeoRecord, StorefrontSeoRevision } from './storefront-seo.entity';
import { StorefrontSeoService } from './storefront-seo.service';

describe('public SEO with real isolated SQL publication and catalog membership', () => {
    let data: DataSource;
    let seo: StorefrontSeoService;
    let publicSeo: StorefrontPublicSeoService;
    let mode: 'LIVE' | 'PREVIEW' | 'CLOSED';
    const context = (id = 1, languageCode = 'en', admin = false): RequestContext =>
        ({
            channelId: id,
            channel: { id, code: `store-${id}`, availableLanguageCodes: ['zh_Hans', 'en'] },
            languageCode,
            apiType: admin ? 'admin' : 'shop',
            activeUserId: admin ? `operator-${id}` : undefined,
            userHasPermissions: (_permissions: Permission[]) => admin,
            copy: (changes: { languageCode?: string }) =>
                context(id, changes.languageCode ?? languageCode, admin),
        }) as unknown as RequestContext;

    beforeEach(async () => {
        // All persistence and joins use :memory:. No runtime database or production configuration is accessed.
        const id = { id: { type: Number, primary: true, generated: true } } as const;
        const timestamps = {
            createdAt: { type: Date, createDate: true },
            updatedAt: { type: Date, updateDate: true },
        } as const;
        const channels = { type: 'many-to-many', target: 'Channel', joinTable: true } as const;
        const translationColumns = {
            ...id,
            baseId: { type: Number },
            languageCode: { type: String },
            name: { type: String },
            description: { type: String },
        } as const;
        data = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            synchronize: true,
            entities: [
                new EntitySchema({ name: 'Channel', target: Channel, columns: id }),
                new EntitySchema({
                    name: 'StoreDomain',
                    target: StoreDomain,
                    columns: {
                        ...id,
                        channelId: { type: Number },
                        domain: { type: String },
                        isPrimary: { type: Boolean },
                        status: { type: String },
                        verifiedAt: { type: Date, nullable: true },
                    },
                }),
                new EntitySchema({
                    name: 'StoreProfile',
                    target: StoreProfile,
                    columns: {
                        ...id,
                        channelId: { type: Number },
                        descriptionZh: { type: String },
                        descriptionEn: { type: String },
                    },
                }),
                new EntitySchema<Product>({
                    name: 'Product',
                    target: Product,
                    columns: {
                        ...id,
                        ...timestamps,
                        enabled: { type: Boolean },
                        deletedAt: { type: Date, nullable: true },
                    },
                    relations: {
                        channels,
                        translations: {
                            type: 'one-to-many',
                            target: 'ProductTranslation',
                            inverseSide: 'base',
                        },
                    },
                }),
                new EntitySchema<ProductTranslation & { baseId: number }>({
                    name: 'ProductTranslation',
                    target: ProductTranslation,
                    columns: translationColumns,
                    relations: {
                        base: { type: 'many-to-one', target: 'Product', joinColumn: { name: 'baseId' } },
                    },
                }),
                new EntitySchema<Collection>({
                    name: 'Collection',
                    target: Collection,
                    columns: {
                        ...id,
                        ...timestamps,
                        isPrivate: { type: Boolean },
                        isRoot: { type: Boolean },
                    },
                    relations: {
                        channels,
                        translations: {
                            type: 'one-to-many',
                            target: 'CollectionTranslation',
                            inverseSide: 'base',
                        },
                    },
                }),
                new EntitySchema<CollectionTranslation & { baseId: number }>({
                    name: 'CollectionTranslation',
                    target: CollectionTranslation,
                    columns: translationColumns,
                    relations: {
                        base: { type: 'many-to-one', target: 'Collection', joinColumn: { name: 'baseId' } },
                    },
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRecord',
                    target: StorefrontSeoRecord,
                    columns: {
                        ...id,
                        ...timestamps,
                        channelId: { type: Number },
                        targetType: { type: String },
                        targetId: { type: String },
                        languageCode: { type: String },
                        draftJson: { type: String },
                        publishedJson: { type: String, nullable: true },
                        version: { type: Number },
                        publishedVersion: { type: Number },
                        publishedAt: { type: Date, nullable: true },
                        publishedByUserId: { type: String, nullable: true },
                    },
                    indices: [
                        { columns: ['channelId', 'targetType', 'targetId', 'languageCode'], unique: true },
                    ],
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRevision',
                    target: StorefrontSeoRevision,
                    columns: {
                        ...id,
                        ...timestamps,
                        channelId: { type: Number },
                        recordId: { type: Number },
                        version: { type: Number },
                        payloadJson: { type: String, nullable: true },
                        publishedAt: { type: Date },
                        publishedBy: { type: String },
                    },
                }),
            ],
        });
        await data.initialize();
        await data.getRepository(Channel).save([{ id: 1 }, { id: 2 }]);
        for (const store of [1, 2]) {
            await data.getRepository(StoreDomain).save({
                channelId: store,
                domain: `store-${store}.test`,
                isPrimary: true,
                status: 'ACTIVE',
                verifiedAt: new Date('2026-10-01'),
            });
            await data.getRepository(StoreProfile).save({
                channelId: store,
                descriptionZh: `店铺 ${store} 正文`,
                descriptionEn: `Store ${store} description`,
            });
            await data
                .getRepository(Product)
                .save({ id: store * 10, enabled: true, deletedAt: null, channels: [{ id: store }] });
            await data.getRepository(ProductTranslation).save([
                {
                    baseId: store * 10,
                    languageCode: LanguageCode.zh_Hans,
                    name: `商品 ${store}`,
                    description: `完整商品 ${store} 正文`,
                },
                {
                    baseId: store * 10,
                    languageCode: LanguageCode.en,
                    name: `Product ${store}`,
                    description: `Complete product ${store} description`,
                },
            ]);
        }
        const connection = {
            getRepository: (_ctx: RequestContext, target: typeof Product) => data.getRepository(target),
            withTransaction: (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) =>
                work(ctx),
            findOneInChannel: (
                _ctx: RequestContext,
                target: typeof Product,
                targetId: string,
                channelId: number,
            ) =>
                data
                    .getRepository(target)
                    .createQueryBuilder('entity')
                    .innerJoin('entity.channels', 'channel', 'channel.id = :channelId', { channelId })
                    .where('entity.id = :targetId', { targetId })
                    .getOne(),
        } as unknown as TransactionalConnection;
        mode = 'LIVE';
        const activation = { getAccessMode: vi.fn(() => Promise.resolve(mode)) };
        seo = new StorefrontSeoService(
            connection,
            activation as never,
            { publish: vi.fn().mockResolvedValue(undefined) } as never,
        );
        publicSeo = new StorefrontPublicSeoService(
            seo,
            connection,
            activation as never,
            { findPublished: vi.fn().mockResolvedValue([]) } as never,
            {} as never,
        );
        for (const store of [1, 2]) {
            const settings = defaultStorefrontSeoSettings();
            settings.indexingEnabled = true;
            settings.platformBindings = [
                {
                    platform: 'GSC',
                    property: `sc-domain:store-${store}.test`,
                    status: 'UNVERIFIED',
                    verifiedAt: null,
                    note: 'private-platform-note',
                },
            ];
            await seo.saveDraft(context(store, 'en', true), {
                ...storefrontSeoSettingsIdentity,
                expectedVersion: 0,
                draft: settings,
            });
            await seo.publish(context(store, 'en', true), {
                ...storefrontSeoSettingsIdentity,
                expectedVersion: 1,
            });
        }
    });
    afterEach(async () => {
        if (data?.isInitialized) await data.destroy();
    });

    const page = (
        ctx: RequestContext,
        productId = String(Number(ctx.channelId) * 10),
        price = 1250,
    ): StorefrontPageData => ({
        schemaVersion: 1,
        version: 'fixture',
        generatedAt: 1,
        scope: {
            host: `store-${ctx.channelId}.test`,
            channelCode: ctx.channel.code,
            languageCode: ctx.languageCode,
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        route: `/product?id=${productId}`,
        request: { kind: 'product', id: productId },
        failures: [],
        media: [],
        config: {
            accessMode: 'LIVE',
            customFields: {
                storefrontNameZh: `店铺 ${ctx.channelId}`,
                storefrontNameEn: `Store ${ctx.channelId}`,
            },
            description: 'Real published description',
            logoUrl: null,
        },
        product: {
            id: productId,
            name: ctx.languageCode === LanguageCode.zh_Hans ? '真实商品' : 'Actual product',
            description: 'Actual published body',
            customFields: { pricingMode: 'SALE' },
            featuredAsset: null,
            variants: [
                {
                    id: 'variant',
                    sku: 'ACTUAL',
                    currencyCode: 'MYR',
                    priceWithTax: price,
                    saleableStockLevel: 5,
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
        },
    });
    const productIdentity: StorefrontSeoIdentity = {
        targetType: 'PRODUCT',
        targetId: '10',
        languageCode: 'en',
    };

    it('reads only published metadata for the right store and retains live price facts', async () => {
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 0,
            draft: { title: 'Published store one title' },
        });
        await seo.publish(context(1, 'en', true), { ...productIdentity, expectedVersion: 1 });
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 2,
            draft: { title: 'private-unpublished-title' },
        });
        const first = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        expect(first.seo).toMatchObject({
            title: 'Published store one title',
            canonical: 'https://store-1.test/en/product?id=10',
            indexable: true,
        });
        expect(first.seo?.alternates.map(item => item.language)).toEqual(['zh-CN', 'en']);
        expect(JSON.stringify(first)).not.toMatch(
            /private-platform-note|private-unpublished-title|platformBindings|aiCitations/,
        );
        const updated = await publicSeo.enrich(context(), 'store-1.test', page(context(), '10', 2750));
        expect(updated.seo?.structuredData.find(item => item['@type'] === 'Product')).toMatchObject({
            offers: { price: '27.50' },
        });
        const second = await publicSeo.enrich(context(2), 'store-2.test', page(context(2)));
        expect(second.seo?.title).not.toContain('store one');
        expect(second.seo?.canonical).toBe('https://store-2.test/en/product?id=20');
        await expect(publicSeo.enrich(context(2), 'store-2.test', page(context(2), '10'))).rejects.toThrow(
            'Public product not found',
        );
    });

    it('does not let a translated SEO record invent missing underlying language content or LIVE status', async () => {
        await data
            .getRepository(ProductTranslation)
            .createQueryBuilder()
            .update()
            .set({ description: '' })
            .where('baseId = :id AND languageCode = :code', { id: 10, code: LanguageCode.en })
            .execute();
        await seo.saveDraft(context(1, 'en', true), {
            ...productIdentity,
            expectedVersion: 0,
            draft: {
                title: 'Complete-looking metadata',
                description: 'Metadata cannot replace the actual body',
            },
        });
        await seo.publish(context(1, 'en', true), { ...productIdentity, expectedVersion: 1 });
        const english = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        expect(english.seo?.indexable).toBe(false);
        expect(english.seo?.reasons).toContain('LANGUAGE_CONTENT_INCOMPLETE');
        expect(english.seo?.alternates).toEqual([]);
        const chinese = await publicSeo.enrich(
            context(1, 'zh_Hans'),
            'store-1.test',
            page(context(1, 'zh_Hans')),
        );
        expect(chinese.seo?.indexable).toBe(true);
        expect(chinese.seo?.alternates.map(item => item.language)).toEqual(['zh-CN']);
        mode = 'PREVIEW';
        const preview = await publicSeo.enrich(
            context(1, 'zh_Hans'),
            'store-1.test',
            page(context(1, 'zh_Hans')),
        );
        expect(preview.seo?.robots).toBe('noindex, follow');
        expect(preview.seo?.reasons).toContain('STORE_NOT_LIVE');
    });
    it.each(['document-publish', 'document-unpublish', 'settings-publish', 'settings-unpublish'])(
        'rejects rendered output after %s changes its real SQL publication',
        async action => {
            const admin = context(1, 'en', true);
            await seo.saveDraft(admin, {
                ...productIdentity,
                expectedVersion: 0,
                draft: { title: 'Published title' },
            });
            await seo.publish(admin, { ...productIdentity, expectedVersion: 1 });
            const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
            await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
            const identity = action.startsWith('settings') ? storefrontSeoSettingsIdentity : productIdentity;
            if (action.endsWith('unpublish')) await seo.unpublish(admin, { ...identity, expectedVersion: 2 });
            else {
                await seo.saveDraft(admin, {
                    ...identity,
                    expectedVersion: 2,
                    draft:
                        identity.targetType === 'SETTINGS'
                            ? { indexingEnabled: false }
                            : { title: 'Next published title' },
                });
                await seo.publish(admin, { ...identity, expectedVersion: 3 });
            }
            await expect(publicSeo.assertOutput(context(), rendered)).rejects.toThrow(
                'Public authority changed',
            );
        },
    );
    it('does not send a previously rendered SQL-backed page after closure or primary domain withdrawal', async () => {
        const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
        await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
        mode = 'CLOSED';
        await expect(publicSeo.assertOutput(context(), rendered)).rejects.toMatchObject({
            code: 'STOREFRONT_CLOSED',
        });
        mode = 'LIVE';
        await data.getRepository(StoreDomain).update({ channelId: 1 }, { verifiedAt: null });
        await expect(publicSeo.assertOutput(context(), rendered)).rejects.toThrow('Public authority changed');
    });
    it.each(['disable', 'unassign', 'remove-language-body'])(
        'rejects default product metadata after the real SQL catalog changes: %s',
        async action => {
            const rendered = await publicSeo.enrich(context(), 'store-1.test', page(context()));
            expect(rendered.seo).toMatchObject({ indexable: true, documentVersion: 0 });
            await expect(publicSeo.assertOutput(context(), rendered)).resolves.toBeUndefined();
            if (action === 'disable')
                await data.getRepository(Product).update({ id: 10 }, { enabled: false });
            else if (action === 'unassign') await data.getRepository(Product).save({ id: 10, channels: [] });
            else
                await data
                    .getRepository(ProductTranslation)
                    .createQueryBuilder()
                    .update()
                    .set({ description: '' })
                    .where('baseId = :id AND languageCode = :code', { id: 10, code: LanguageCode.en })
                    .execute();
            await expect(publicSeo.assertOutput(context(), rendered)).rejects.toBeInstanceOf(
                action === 'remove-language-body' ? ServiceUnavailableException : NotFoundException,
            );
        },
    );
});

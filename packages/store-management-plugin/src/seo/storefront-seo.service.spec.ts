import { Channel, Permission, type RequestContext, type TransactionalConnection } from '@vendure/core';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddStorefrontSeo1791580800000 } from '../../../dev-server/migrations/1791580800000-add-storefront-seo';

import {
    defaultStorefrontSeoSettings,
    storefrontSeoSettingsIdentity,
    type StorefrontSeoIdentity,
} from './storefront-seo.contract';
import { StorefrontSeoRecord, StorefrontSeoRevision } from './storefront-seo.entity';
import { StorefrontSeoService } from './storefront-seo.service';

describe('SEO SQL persistence, versions and channel authorization', () => {
    let data: DataSource;
    let service: StorefrontSeoService;
    let events: ReturnType<typeof vi.fn>;
    let membership: ReturnType<typeof vi.fn>;
    const ctx = (id = 1, permissions = ['ReadStorefrontContent', 'UpdateStorefrontContent']) =>
        ({
            channelId: id,
            channel: { id, code: `store-${id}`, availableLanguageCodes: ['zh_Hans', 'en'] },
            apiType: 'admin',
            activeUserId: `admin-${id}`,
            userHasPermissions: (requested: Permission[]) =>
                requested.some(permission => permissions.includes(permission)),
        }) as unknown as RequestContext;
    beforeEach(async () => {
        // Isolated in-memory SQL only; no host filesystem database or runtime migration is used.
        const base = {
            id: { type: Number, primary: true, generated: true },
            createdAt: { type: Date, createDate: true },
            updatedAt: { type: Date, updateDate: true },
            channelId: { type: Number },
        } as const;
        // The migration creates the real tables/FKs. Minimal metadata avoids bootstrapping unrelated commerce entities.
        data = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            synchronize: false,
            entities: [
                new EntitySchema({
                    name: 'Channel',
                    target: Channel,
                    columns: { id: { type: Number, primary: true, generated: true } },
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRecord',
                    tableName: 'storefront_seo_record',
                    target: StorefrontSeoRecord,
                    columns: {
                        ...base,
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
                }),
                new EntitySchema({
                    name: 'StorefrontSeoRevision',
                    tableName: 'storefront_seo_revision',
                    target: StorefrontSeoRevision,
                    columns: {
                        ...base,
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
        await data.query('CREATE TABLE channel (id integer PRIMARY KEY)');
        await new AddStorefrontSeo1791580800000().up(data.createQueryRunner());
        await data.getRepository(Channel).insert([{ id: 1 }, { id: 2 }]);
        events = vi.fn().mockResolvedValue(undefined);
        membership = vi
            .fn()
            .mockImplementation((_ctx, _target, id, channelId) =>
                Promise.resolve(String(id) === '10' && channelId === 1 ? { id: 10, deletedAt: null } : null),
            );
        const connection = {
            getRepository: (_ctx: RequestContext, target: typeof StorefrontSeoRecord) =>
                data.getRepository(target),
            withTransaction: (context: RequestContext, work: (context: RequestContext) => Promise<unknown>) =>
                work(context),
            findOneInChannel: membership,
        } as unknown as TransactionalConnection;
        service = new StorefrontSeoService(
            connection,
            { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
            { publish: events } as never,
        );
    });
    afterEach(async () => {
        if (data?.isInitialized) await data.destroy();
    });
    const save = (draft: unknown, expectedVersion: number, context = ctx()) =>
        service.saveDraft(context, { ...storefrontSeoSettingsIdentity, expectedVersion, draft });
    it('creates additive migration tables with channel identity constraints and retains publication history on rollback', async () => {
        const runner = data.createQueryRunner();
        await new AddStorefrontSeo1791580800000().up(runner);
        const recordTable = await runner.getTable('storefront_seo_record');
        expect(
            recordTable?.indices.find(index => index.name === 'UQ_storefront_seo_identity')?.isUnique,
        ).toBe(true);
        expect(recordTable?.foreignKeys[0].referencedTableName).toBe('channel');
        expect((await runner.getTable('storefront_seo_revision'))?.foreignKeys).toHaveLength(2);
        await expect(new AddStorefrontSeo1791580800000().down()).rejects.toThrow('retained');
    });
    it('separates draft from published values and publishes a channel-scoped invalidation event', async () => {
        const saved = await save({ ...defaultStorefrontSeoSettings(), indexingEnabled: true }, 0);
        expect(saved.version).toBe(1);
        expect(await service.publishedConfiguration(ctx())).toBeNull();
        const published = await service.publish(ctx(), {
            ...storefrontSeoSettingsIdentity,
            expectedVersion: 1,
        });
        expect(published).toMatchObject({ version: 2, publishedVersion: 1 });
        await save({ ...defaultStorefrontSeoSettings(), indexingEnabled: false }, 2);
        expect((await service.publishedConfiguration(ctx()))?.payload.indexingEnabled).toBe(true);
        expect(await service.publishedConfiguration(ctx(2))).toBeNull();
        expect(events).toHaveBeenCalledOnce();
        expect(events.mock.calls[0][0].options.channelIds).toEqual([1]);
    });
    it('rejects stale saves and competing SQL compare-and-swap writes', async () => {
        await save(defaultStorefrontSeoSettings(), 0);
        await expect(save(defaultStorefrontSeoSettings(), 0)).rejects.toThrow('SEO_VERSION_CONFLICT');
        const writes = await Promise.allSettled([
            save({ indexingEnabled: true }, 1),
            save({ indexingEnabled: false }, 1),
        ]);
        expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1);
        expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1);
        expect((await service.getRecord(ctx(), storefrontSeoSettingsIdentity)).version).toBe(2);
    });
    it('restores metadata to a draft without overwriting live configuration, then records withdrawal', async () => {
        await save({ indexingEnabled: true }, 0);
        await service.publish(ctx(), { ...storefrontSeoSettingsIdentity, expectedVersion: 1 });
        await save({ indexingEnabled: false }, 2);
        await service.publish(ctx(), { ...storefrontSeoSettingsIdentity, expectedVersion: 3 });
        const restored = await service.restoreRevision(ctx(), {
            ...storefrontSeoSettingsIdentity,
            expectedVersion: 4,
            revision: 1,
        });
        expect(restored.draft).toMatchObject({ indexingEnabled: true });
        expect((await service.publishedConfiguration(ctx()))?.payload.indexingEnabled).toBe(false);
        await service.unpublish(ctx(), { ...storefrontSeoSettingsIdentity, expectedVersion: 5 });
        expect(await service.publishedConfiguration(ctx())).toBeNull();
        const history = await service.history(ctx(), storefrontSeoSettingsIdentity);
        expect(history.map(revision => revision.version)).toEqual([3, 2, 1]);
        expect(history[0].payload).toBeNull();
        await expect(
            service.restoreRevision(ctx(2), {
                ...storefrontSeoSettingsIdentity,
                expectedVersion: 0,
                revision: 1,
            }),
        ).rejects.toThrow('历史版本');
    });
    it('uses target permissions without granting a content editor product writes or cross-store reads', async () => {
        const identity: StorefrontSeoIdentity = { targetType: 'PRODUCT', targetId: '10', languageCode: 'en' };
        await expect(
            service.saveDraft(ctx(), { ...identity, expectedVersion: 0, draft: { title: 'Product' } }),
        ).rejects.toThrow();
        const catalog = ctx(1, ['ReadProduct', 'UpdateProduct']);
        await service.saveDraft(catalog, { ...identity, expectedVersion: 0, draft: { title: 'Product' } });
        await expect(service.getRecord(ctx(2, ['ReadProduct']), identity)).rejects.toThrow();
        expect(membership).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 2 }),
            expect.anything(),
            '10',
            2,
        );
        await expect(
            service.getRecord({ ...catalog, apiType: 'shop' } as RequestContext, identity),
        ).rejects.toThrow();
    });
    it('checks article evidence on publication and never stores current product price or stock', async () => {
        const identity: StorefrontSeoIdentity = {
            targetType: 'ARTICLE',
            targetId: 'guide',
            languageCode: 'en',
        };
        await service.saveDraft(ctx(), {
            ...identity,
            expectedVersion: 0,
            draft: { title: 'Guide', article: { body: 'Unreviewed' } },
        });
        await expect(service.publish(ctx(), { ...identity, expectedVersion: 1 })).rejects.toThrow('审核');
        expect(await service.publishedRecord(ctx(), identity)).toBeNull();
        await expect(
            service.saveDraft(ctx(2), {
                ...identity,
                expectedVersion: 0,
                draft: { article: { relatedProductIds: ['10'] } },
            }),
        ).rejects.toThrow('相关商品');
        await expect(
            service.saveDraft(ctx(1, ['UpdateProduct']), {
                targetType: 'PRODUCT',
                targetId: '10',
                languageCode: 'en',
                expectedVersion: 0,
                draft: { title: 'Product', stock: 10 },
            }),
        ).rejects.toThrow('未支持');
    });
    it('shows rendered public paths while filtering records by channel and target read permissions', async () => {
        await service.saveDraft(ctx(1, ['ReadProduct', 'UpdateProduct']), {
            targetType: 'PRODUCT',
            targetId: '10',
            languageCode: 'en',
            expectedVersion: 0,
            draft: { title: 'Product' },
        });
        await service.saveDraft(ctx(), {
            targetType: 'ARTICLE',
            targetId: 'guide',
            languageCode: 'en',
            expectedVersion: 0,
            draft: { title: 'Guide' },
        });
        await service.saveDraft(ctx(), {
            targetType: 'PAGE',
            targetId: 'terms',
            languageCode: 'en',
            expectedVersion: 0,
            draft: { title: 'Terms' },
        });
        const workspace = await service.workspace(ctx());
        expect(workspace.documents.map(document => document.targetId)).toEqual(['guide', 'terms']);
        expect(workspace.diagnostics.find(issue => issue.targetType === 'ARTICLE')?.message).toContain(
            '/en/guides/guide：只有草稿，文章尚未公开',
        );
        expect(workspace.diagnostics.find(issue => issue.targetId === 'terms')?.message).toContain(
            '/en/legal?id=terms',
        );
        expect((await service.workspace(ctx(2))).documents).toEqual([]);
    });
});

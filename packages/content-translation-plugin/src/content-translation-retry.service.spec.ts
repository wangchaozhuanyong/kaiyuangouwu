import 'reflect-metadata';
import {
    Column,
    DataSource,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationRetryService } from './content-translation-retry.service.js';
import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationProviderState } from './entities/translation-provider-state.entity.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';
import { TranslationExecutionService } from './translation-execution.service.js';
import { TranslationProviderError } from './translation-provider-error.js';

// These SQL fixtures mirror real ownership: an item has blockId, never a direct channelId.
@Entity()
class StorefrontContentBlock {
    @PrimaryGeneratedColumn() id: number;
    @Column('int') channelId: number;
}
@Entity()
class StorefrontContentItem {
    @PrimaryGeneratedColumn() id: number;
    @Column('int') blockId: number;
    @ManyToOne(() => StorefrontContentBlock) block: StorefrontContentBlock;
    @OneToMany(() => ItemTranslation, translation => translation.base) translations: ItemTranslation[];
}
@Entity()
class ItemTranslation {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') languageCode: string;
    @Column('varchar', { length: 255 }) label: string;
    @Column('varchar', { default: '' }) description: string;
    @ManyToOne(() => StorefrontContentItem, item => item.translations) base: StorefrontContentItem;
}
@Entity()
class Channel {
    @PrimaryGeneratedColumn() id: number;
}
@Entity()
class Facet {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => Channel) @JoinTable() channels: Channel[];
    @OneToMany(() => FacetTranslation, translation => translation.base) translations: FacetTranslation[];
}
@Entity()
class FacetTranslation {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') languageCode: string;
    @Column('varchar') name: string;
    @ManyToOne(() => Facet, facet => facet.translations) base: Facet;
}
PrimaryGeneratedColumn()(ContentTranslationState.prototype, 'id');
let db: DataSource;
let source: ItemTranslation;
let target: ItemTranslation;
let state: ContentTranslationState;
let translate: ReturnType<typeof vi.fn>;
let service: ContentTranslationService;
let retry: ContentTranslationRetryService;
let adapter: TranslationContentAdapter;
let execution: TranslationExecutionService;
let connection: any;
let options: any;
let clock: number;
const advance = (milliseconds: number) => {
    clock += milliseconds;
};
const ctx = { channelId: '1' } as any;

beforeEach(async () => {
    db = await new DataSource({
        ...(process.env.TRANSLATION_TEST_POSTGRES === '1'
            ? {
                  type: 'postgres' as const,
                  host: '127.0.0.1',
                  port: 15492,
                  username: 'postgres',
                  database: 'translation_outbox_e2e',
                  schema: 'outbox_test',
              }
            : { type: 'sqljs' as const }),
        entities: [
            Channel,
            Facet,
            FacetTranslation,
            StorefrontContentBlock,
            StorefrontContentItem,
            ItemTranslation,
            ContentTranslationState,
            TranslationProviderState,
        ],
    }).initialize();
    if (process.env.TRANSLATION_TEST_POSTGRES === '1') {
        await db.query('CREATE SCHEMA IF NOT EXISTS outbox_test');
    }
    await db.synchronize(true);
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    translate = vi.fn((request: any) =>
        Promise.resolve({
            provider: 'test',
            translations: request.segments.map((segment: any) => ({
                key: segment.key,
                text: 'Business services',
            })),
        }),
    );
    connection = {
        rawConnection: db,
        getRepository: (context: any, entity: any) => (context?.manager ?? db.manager).getRepository(entity),
        withTransaction: (context: any, fn: any) => db.transaction(manager => fn({ ...context, manager })),
    };
    options = {
        provider: { name: 'test', isConfigured: () => true, translate },
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
        glossary: {},
    };
    execution = new TranslationExecutionService(connection, options);
    service = new ContentTranslationService(connection, options, execution);
    adapter = new TranslationContentAdapter(connection);
    retry = new ContentTranslationRetryService(connection, service, adapter);
    const block = await db.getRepository(StorefrontContentBlock).save({ channelId: 1 });
    const item = await db.getRepository(StorefrontContentItem).save({ blockId: block.id });
    [source, target] = await db.getRepository(ItemTranslation).save([
        { base: item, languageCode: 'zh_Hans', label: '商业服务' },
        { base: item, languageCode: 'en', label: 'Previous services' },
    ]);
    state = await service.recordState(ctx, {
        channelId: 1,
        entityType: 'StorefrontContentItem',
        entityId: item.id,
        fieldPath: 'label',
        sourceText: source.label,
        translatedText: target.label,
        status: 'PENDING',
        origin: 'AUTO',
        locked: false,
    });
});
afterEach(async () => {
    await db?.destroy();
    vi.restoreAllMocks();
});
const readState = () => db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id });
const english = async () =>
    (await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label;

describe('durable translation outbox with an isolated SQL database', () => {
    it('applies pending English without changing Chinese and consumes the task once', async () => {
        expect(await retry.retryPending()).toEqual({ scanned: 1, translated: 1, deferred: 0 });
        expect(await english()).toBe('Business services');
        expect((await readState()).status).toBe('AUTO_TRANSLATED');
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: source.id })).label).toBe(
            '商业服务',
        );
        await retry.retryPending();
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('persists provider cooldown across new API/worker instances and honors Retry-After', async () => {
        translate.mockRejectedValueOnce(new TranslationProviderError('RATE_LIMIT', 180_000));
        await retry.retryPending();
        expect(await english()).toBe('Previous services');
        expect(await readState()).toMatchObject({
            status: 'PENDING',
            attempts: 1,
            nextAttemptAt: new Date(Date.now() + 180_000),
        });
        const restarted = new TranslationExecutionService(connection, options);
        await expect(
            restarted.translate({ ...options, segments: [{ key: 'preview', text: '服务' }] }),
        ).rejects.toMatchObject({ code: 'BUSY' });
        await retry.retryPending();
        expect(translate).toHaveBeenCalledTimes(1);
        advance(180_001);
        await new ContentTranslationRetryService(connection, service, adapter).retryPending();
        expect(await english()).toBe('Business services');
    });

    it('retains durable notification state and retries it without another paid translation', async () => {
        const notify = vi.spyOn(adapter, 'notify').mockRejectedValueOnce(new Error('index offline'));
        await retry.retryPending();
        expect(await readState()).toMatchObject({
            status: 'NOTIFY_PENDING',
            lastErrorCode: 'NOTIFICATION_FAILED',
        });
        expect(await english()).toBe('Business services');
        advance(60_001);
        notify.mockResolvedValue(undefined);
        await new ContentTranslationRetryService(connection, service, adapter).retryPending();
        expect((await readState()).status).toBe('AUTO_TRANSLATED');
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it.each(['Chinese edit', 'manual English'])('never applies a response over a newer %s', async kind => {
        translate.mockImplementationOnce(async (request: any) => {
            if (kind === 'Chinese edit') {
                await db.getRepository(ItemTranslation).update(source.id, { label: '新服务' });
                await service.recordState(ctx, {
                    channelId: 1,
                    entityType: state.entityType,
                    entityId: state.entityId,
                    fieldPath: 'label',
                    sourceText: '新服务',
                    translatedText: target.label,
                    status: 'PENDING',
                    origin: 'AUTO',
                });
            } else {
                await db.getRepository(ItemTranslation).update(target.id, { label: 'Reviewed services' });
                await service.recordState(ctx, {
                    channelId: 1,
                    entityType: state.entityType,
                    entityId: state.entityId,
                    fieldPath: 'label',
                    sourceText: source.label,
                    translatedText: 'Reviewed services',
                    status: 'MANUAL_LOCKED',
                    origin: 'MANUAL',
                    locked: true,
                });
            }
            return {
                translations: request.segments.map((segment: any) => ({
                    key: segment.key,
                    text: 'Outdated response',
                })),
            };
        });
        expect((await retry.retryPending()).translated).toBe(0);
        expect(await english()).toBe(kind === 'Chinese edit' ? 'Previous services' : 'Reviewed services');
        expect((await readState()).revision).toBe(2);
    });

    it('uses the parent block to reject cross-shop item tasks', async () => {
        await db.getRepository(ContentTranslationState).update(state.id, { channelId: '2' });
        await retry.retryPending();
        expect(translate).not.toHaveBeenCalled();
        expect((await readState()).status).toBe('CANCELLED');
        expect(await english()).toBe('Previous services');
    });

    it('cancels deleted records without consuming provider capacity', async () => {
        await db.getRepository(ItemTranslation).delete({ base: { id: Number(state.entityId) } });
        await db.getRepository(StorefrontContentItem).delete(state.entityId);
        await retry.retryPending();
        expect((await readState()).status).toBe('CANCELLED');
        expect(translate).not.toHaveBeenCalled();
    });

    it('keeps a permanent bad field out of the automatic retry loop', async () => {
        translate.mockResolvedValueOnce({ translations: [{ key: String(state.id), text: 'x'.repeat(256) }] });
        await retry.retryPending();
        expect(await readState()).toMatchObject({
            status: 'FAILED',
            nextAttemptAt: null,
            lastErrorCode: 'TEXT_TOO_LONG',
        });
        advance(900_000);
        await retry.retryPending();
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('an unchanged save preserves retries and does not relock old automatic English', async () => {
        translate.mockRejectedValueOnce(new TranslationProviderError('RATE_LIMIT'));
        await retry.retryPending();
        const before = await readState();
        const fields = await service.prepareLocalizedFields([
            {
                path: 'label',
                sourceText: source.label,
                existingSourceText: source.label,
                existingTargetText: target.label,
            },
        ]);
        await service.recordPreparedFields(
            ctx,
            { channelId: 1, entityType: state.entityType, entityId: state.entityId },
            fields,
        );
        expect(await readState()).toMatchObject({
            revision: before.revision,
            attempts: 1,
            locked: false,
            nextAttemptAt: before.nextAttemptAt,
        });
    });

    it('deduplicates identical segments in a compatible batch', async () => {
        await db.getRepository(ItemTranslation).update(source.id, { description: source.label });
        await service.recordState(ctx, {
            channelId: 1,
            entityType: state.entityType,
            entityId: state.entityId,
            fieldPath: 'description',
            sourceText: source.label,
            translatedText: '',
            status: 'PENDING',
        });
        await retry.retryPending();
        expect(translate).toHaveBeenCalledTimes(1);
        expect(translate.mock.calls[0][0].segments).toHaveLength(1);
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).description).toBe(
            'Business services',
        );
    });

    it('excludes a second worker while the first holds a task and provider lease', async () => {
        let release!: () => void;
        let started!: () => void;
        const entered = new Promise<void>(resolve => {
            started = resolve;
        });
        translate.mockImplementationOnce(async (request: any) => {
            started();
            await new Promise<void>(resolve => {
                release = resolve;
            });
            return { translations: [{ key: request.segments[0].key, text: 'Business services' }] };
        });
        const first = retry.retryPending();
        await entered;
        const second = await new ContentTranslationRetryService(connection, service, adapter).retryPending();
        expect(second.scanned).toBe(0);
        release();
        await first;
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('fences out a timed-out provider result and recovers its expired task lease', async () => {
        translate.mockImplementationOnce((request: any) => {
            advance(61_000);
            return Promise.resolve({
                translations: [{ key: request.segments[0].key, text: 'Late translation' }],
            });
        });
        await retry.retryPending();
        expect(await english()).toBe('Previous services');
        advance(1001);
        await retry.retryPending();
        expect(await english()).toBe('Business services');
    });

    it('rolls back Chinese and its outbox row together on a business failure', async () => {
        await expect(
            connection.withTransaction(ctx, async (transactionCtx: any) => {
                await connection
                    .getRepository(transactionCtx, ItemTranslation)
                    .update(source.id, { label: '必须回滚' });
                await service.recordState(transactionCtx, {
                    channelId: 1,
                    entityType: state.entityType,
                    entityId: state.entityId,
                    fieldPath: 'label',
                    sourceText: '必须回滚',
                    translatedText: target.label,
                    status: 'PENDING',
                });
                throw new Error('business save failed');
            }),
        ).rejects.toThrow('business save failed');
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: source.id })).label).toBe(
            source.label,
        );
        expect((await readState()).sourceHash).toBe(contentTranslationInternals.hash(source.label));
    });

    it('manual retry respects channel and lock boundaries', async () => {
        await expect(retry.requestRetry({ channelId: '2' } as any, [String(state.id)])).rejects.toThrow(
            '店铺',
        );
        await db
            .getRepository(ContentTranslationState)
            .update(state.id, { locked: true, origin: 'MANUAL', status: 'MANUAL_LOCKED' });
        await expect(retry.requestRetry(ctx, [String(state.id)])).rejects.toThrow('人工锁定');
    });
});

it('can explicitly lock an unchanged automatic translation', async () => {
    const fields = await service.prepareLocalizedFields([
        {
            path: 'label',
            sourceText: source.label,
            existingSourceText: source.label,
            existingTargetText: target.label,
            targetText: target.label,
            manualLock: true,
        },
    ]);
    await service.recordPreparedFields(
        ctx,
        { channelId: 1, entityType: state.entityType, entityId: state.entityId },
        fields,
    );
    expect(await readState()).toMatchObject({ status: 'MANUAL_LOCKED', locked: true, origin: 'MANUAL' });
    await retry.retryPending();
    expect(translate).not.toHaveBeenCalled();
});

it('manual retries cannot bypass a provider Retry-After deadline', async () => {
    translate.mockRejectedValueOnce(new TranslationProviderError('RATE_LIMIT', 180_000));
    await retry.retryPending();
    await retry.requestRetry(ctx, [String(state.id)]);
    await execution.reset();
    await retry.retryPending();
    expect(translate).toHaveBeenCalledTimes(1);
});

describe('shared native Channel ownership and manual review', () => {
    it.each(['manual', 'reusable', 'unassigned'])(
        'respects %s native translations across Channels',
        async mode => {
            await db.getRepository(ContentTranslationState).clear();
            const channels = await db.getRepository(Channel).save([{}, {}]);
            const facet = await db.getRepository(Facet).save({ channels });
            await db.getRepository(FacetTranslation).save([
                { base: facet, languageCode: 'zh_Hans', name: '精选分类' },
                { base: facet, languageCode: 'en', name: 'Reviewed category' },
            ]);
            await service.recordState(ctx, {
                channelId: channels[0].id,
                entityType: 'Facet',
                entityId: facet.id,
                fieldPath: 'name',
                sourceText: '精选分类',
                translatedText: 'Reviewed category',
                status: mode === 'manual' ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
                origin: mode === 'manual' ? 'MANUAL' : 'AUTO',
                locked: mode === 'manual',
            });
            const queued = await service.recordState(ctx, {
                channelId: mode === 'unassigned' ? 999 : channels[1].id,
                entityType: 'Facet',
                entityId: facet.id,
                fieldPath: 'name',
                sourceText: '精选分类',
                translatedText: '',
                status: 'PENDING',
                origin: 'AUTO',
            });
            await retry.retryPending();
            expect(translate).not.toHaveBeenCalled();
            expect(
                (
                    await db
                        .getRepository(FacetTranslation)
                        .findOneByOrFail({ base: { id: facet.id }, languageCode: 'en' })
                ).name,
            ).toBe('Reviewed category');
            expect(
                (await db.getRepository(ContentTranslationState).findOneByOrFail({ id: queued.id })).status,
            ).toBe(mode === 'manual' ? 'FAILED' : mode === 'unassigned' ? 'CANCELLED' : 'AUTO_TRANSLATED');
        },
    );
    it('does not let audit retry bypass provider Retry-After', async () => {
        translate.mockRejectedValueOnce(new TranslationProviderError('RATE_LIMIT', 180_000));
        await retry.retryPending();
        await execution.reset();
        await expect(
            execution.translate({ ...options, segments: [{ key: 'preview', text: '服务' }] }),
        ).rejects.toMatchObject({ code: 'BUSY' });
        expect(translate).toHaveBeenCalledTimes(1);
    });
});

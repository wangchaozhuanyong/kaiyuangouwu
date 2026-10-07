import 'reflect-metadata';
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationReviewService } from './content-translation-review.service.js';
import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';

@Entity()
class StorefrontContentBlock {
    @PrimaryGeneratedColumn() id: number;
    @Column('int') channelId: number;
    @Column('varchar') type: string;
    @OneToMany(() => BlockTranslation, row => row.base) translations: BlockTranslation[];
}
@Entity()
class BlockTranslation {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') languageCode: string;
    @Column('varchar') title: string;
    @ManyToOne(() => StorefrontContentBlock, block => block.translations) base: StorefrontContentBlock;
}
PrimaryGeneratedColumn()(ContentTranslationState.prototype, 'id');
const ctx = { channelId: '1' } as any;
let db: DataSource;
let source: BlockTranslation;
let target: BlockTranslation;
let state: ContentTranslationState;
let service: ContentTranslationReviewService;
let translations: ContentTranslationService;
let adapter: TranslationContentAdapter;

beforeEach(async () => {
    db = await new DataSource({
        type: 'sqljs',
        entities: [ContentTranslationState, StorefrontContentBlock, BlockTranslation],
        synchronize: true,
    }).initialize();
    const connection = {
        rawConnection: db,
        getRepository: (context: any, entity: any) => (context?.manager ?? db.manager).getRepository(entity),
        withTransaction: (context: any, fn: any) => db.transaction(manager => fn({ ...context, manager })),
    } as any;
    translations = new ContentTranslationService(connection, {
        provider: { name: 'test', isConfigured: () => true, translate: vi.fn() },
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
        glossary: {},
    });
    adapter = new TranslationContentAdapter(connection);
    service = new ContentTranslationReviewService(connection, adapter);
    const block = await db.getRepository(StorefrontContentBlock).save({ channelId: 1, type: 'CUSTOM' });
    [source, target] = await db.getRepository(BlockTranslation).save([
        { base: block, languageCode: 'zh_Hans', title: '最新中文' },
        { base: block, languageCode: 'en', title: 'Reviewed English' },
    ]);
    state = await translations.recordState(ctx, {
        channelId: 1,
        entityType: 'StorefrontContentBlock',
        entityId: block.id,
        fieldPath: 'title',
        sourceText: source.title,
        translatedText: target.title,
        status: 'STALE',
        origin: 'MANUAL',
        locked: true,
    });
});
afterEach(async () => {
    vi.restoreAllMocks();
    if (db?.isInitialized) await db.destroy();
});
const readState = () => db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id });
const input = () => ({
    id: String(state.id),
    revision: state.revision,
    sourceHash: contentTranslationInternals.hash(source.title),
    translatedHash: contentTranslationInternals.hash(target.title),
});

describe('versioned manual translation review', () => {
    it('loads current text and the real editor on demand without changing state', async () => {
        const detail = await service.review(ctx, String(state.id));
        expect(detail).toMatchObject({
            sourceText: source.title,
            targetText: target.title,
            canConfirm: true,
        });
        expect(detail.editPath).toBe('/storefront/decoration?blockId=1&field=title&language=en');
        expect(await readState()).toMatchObject({ revision: state.revision, status: 'STALE', locked: true });
    });
    it('confirms unchanged correct English while retaining the manual lock and body text', async () => {
        expect(await service.confirm(ctx, input())).toMatchObject({
            status: 'MANUAL_LOCKED',
            origin: 'MANUAL',
            locked: true,
            revision: state.revision + 1,
        });
        expect((await db.getRepository(BlockTranslation).findOneByOrFail({ id: target.id })).title).toBe(
            target.title,
        );
        await expect(service.confirm(ctx, input())).rejects.toThrow('复核期间已变化');
    });
    it.each(['source', 'target'])('rejects changed %s text before confirmation', async changed => {
        await db.getRepository(BlockTranslation).update(changed === 'source' ? source.id : target.id, {
            title: changed === 'source' ? '另一个中文版本' : 'Different English',
        });
        expect((await service.review(ctx, String(state.id))).canConfirm).toBe(false);
        await expect(service.confirm(ctx, input())).rejects.toThrow('复核期间已变化');
        expect((await readState()).status).toBe('STALE');
    });
    it('rejects a newer state revision even when the text still matches', async () => {
        await db.getRepository(ContentTranslationState).update(state.id, { revision: state.revision + 1 });
        await expect(service.confirm(ctx, input())).rejects.toThrow('复核期间已变化');
    });
    it('does not reveal or confirm another store record', async () => {
        await expect(service.review({ channelId: '2' } as any, String(state.id))).rejects.toThrow('不属于');
        await expect(service.confirm({ channelId: '2' } as any, input())).rejects.toThrow('不属于');
    });
    it('refuses an automatic or unlocked record', async () => {
        await db.getRepository(ContentTranslationState).update(state.id, { origin: 'AUTO', locked: false });
        expect((await service.review(ctx, String(state.id))).canConfirm).toBe(false);
        await expect(service.confirm(ctx, input())).rejects.toThrow('不需要人工复核');
    });
    it('rechecks visibility after taking the content lock', async () => {
        vi.spyOn(adapter, 'isVisibleInChannel').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        await expect(service.confirm(ctx, input())).rejects.toThrow('店铺范围已变化');
        expect((await readState()).status).toBe('STALE');
    });
    it('retains STALE on an ordinary unchanged save, but keeps a confirmed field confirmed', async () => {
        const prepared = () =>
            translations.prepareLocalizedFields([
                {
                    path: 'title',
                    sourceText: source.title,
                    targetText: target.title,
                    manualLock: true,
                    existingSourceText: source.title,
                    existingTargetText: target.title,
                },
            ]);
        const identity = { channelId: 1, entityType: state.entityType, entityId: state.entityId };
        await translations.recordPreparedFields(ctx, identity, await prepared());
        expect((await readState()).status).toBe('STALE');
        state = await readState();
        await service.confirm(ctx, input());
        await translations.recordPreparedFields(ctx, identity, await prepared());
        expect(await readState()).toMatchObject({ status: 'MANUAL_LOCKED', locked: true, origin: 'MANUAL' });
        source.title = '再修改中文';
        await translations.recordPreparedFields(ctx, identity, await prepared());
        expect((await readState()).status).toBe('STALE');
    });
});

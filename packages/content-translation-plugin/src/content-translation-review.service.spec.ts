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
@Entity()
class Channel {
    @PrimaryGeneratedColumn() id: number;
}
@Entity()
class ShippingMethod {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => Channel) @JoinTable() channels: Channel[];
    @OneToMany(() => ShippingMethodTranslation, row => row.base) translations: ShippingMethodTranslation[];
}
@Entity()
class ShippingMethodTranslation {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') languageCode: string;
    @Column('varchar') name: string;
    @Column('varchar') description: string;
    @ManyToOne(() => ShippingMethod, method => method.translations) base: ShippingMethod;
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
        entities: [
            ContentTranslationState,
            StorefrontContentBlock,
            BlockTranslation,
            Channel,
            ShippingMethod,
            ShippingMethodTranslation,
        ],
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

async function nativeShippingFixture(fieldPath: 'name' | 'description' = 'name') {
    const channels = await db.getRepository(Channel).save([{ id: 1 }, { id: 2 }]);
    const method = await db.getRepository(ShippingMethod).save({ channels });
    const [shippingSource, shippingTarget] = await db.getRepository(ShippingMethodTranslation).save([
        { base: method, languageCode: 'zh_Hans', name: '普通配送', description: '已核对配送说明' },
        {
            base: method,
            languageCode: 'en',
            name: 'Reviewed shipping method',
            description: 'Reviewed shipping description',
        },
    ]);
    const states: ContentTranslationState[] = [];
    for (const channel of channels) {
        states.push(
            await translations.recordState({ channelId: String(channel.id) } as any, {
                channelId: channel.id,
                entityType: 'ShippingMethod',
                entityId: method.id,
                fieldPath,
                sourceText: shippingSource[fieldPath],
                translatedText: shippingTarget[fieldPath],
                status: 'STALE',
                origin: 'MANUAL',
                locked: true,
            }),
        );
    }
    return {
        method,
        source: shippingSource,
        target: shippingTarget,
        sourceText: shippingSource[fieldPath],
        targetText: shippingTarget[fieldPath],
        state: states[0],
        sibling: states[1],
        input: {
            id: String(states[0].id),
            revision: states[0].revision,
            sourceHash: contentTranslationInternals.hash(shippingSource[fieldPath]),
            translatedHash: contentTranslationInternals.hash(shippingTarget[fieldPath]),
        },
    };
}

describe('versioned manual translation review', () => {
    it.each(['name', 'description'] as const)(
        'reads locked shared native shipping %s without changing text or either owning store audit',
        async field => {
            const native = await nativeShippingFixture(field);
            for (const record of [native.state, native.sibling]) {
                const detail = await service.review(
                    { channelId: record.channelId } as any,
                    String(record.id),
                );
                expect(detail).toMatchObject({
                    sourceText: native.sourceText,
                    targetText: native.targetText,
                    canConfirm: true,
                    editPath: null,
                });
                expect(
                    await db.getRepository(ContentTranslationState).findOneByOrFail({ id: record.id }),
                ).toEqual(record);
            }
            await expect(adapter.load(db.manager, native.state)).rejects.toMatchObject({
                code: 'MANUAL_REVIEW',
            });
            expect(
                (await db.getRepository(ShippingMethodTranslation).findOneByOrFail({ id: native.target.id }))[
                    field
                ],
            ).toBe(native.targetText);
        },
    );
    it.each(['name', 'description'] as const)(
        'confirms locked native shipping %s audit while preserving shared text and the sibling manual lock',
        async field => {
            const native = await nativeShippingFixture(field);
            expect(await service.confirm(ctx, native.input)).toMatchObject({
                status: 'MANUAL_LOCKED',
                origin: 'MANUAL',
                locked: true,
                revision: native.state.revision + 1,
                sourceHash: native.state.sourceHash,
                translatedHash: native.state.translatedHash,
            });
            expect(
                await db.getRepository(ContentTranslationState).findOneByOrFail({ id: native.sibling.id }),
            ).toEqual(native.sibling);
            expect(
                (await db.getRepository(ShippingMethodTranslation).findOneByOrFail({ id: native.source.id }))[
                    field
                ],
            ).toBe(native.sourceText);
            expect(
                (await db.getRepository(ShippingMethodTranslation).findOneByOrFail({ id: native.target.id }))[
                    field
                ],
            ).toBe(native.targetText);
            await expect(adapter.load(db.manager, native.state)).rejects.toMatchObject({
                code: 'MANUAL_REVIEW',
            });
            await expect(service.confirm(ctx, native.input)).rejects.toThrow('复核期间已变化');
        },
    );
    it('keeps native shared shipping review inside the current store and its actual ownership', async () => {
        const native = await nativeShippingFixture();
        await expect(service.review({ channelId: '3' } as any, String(native.state.id))).rejects.toThrow(
            '不属于',
        );
        await expect(service.confirm({ channelId: '3' } as any, native.input)).rejects.toThrow('不属于');
        await db.getRepository(ShippingMethod).save({ id: native.method.id, channels: [{ id: 2 }] });
        await expect(service.review(ctx, String(native.state.id))).rejects.toThrow('不属于');
        await expect(service.confirm(ctx, native.input)).rejects.toThrow('不属于');
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: native.state.id }),
        ).toEqual(native.state);
    });
    it.each(['source', 'target', 'revision'])(
        'retains native review version checks after %s changes',
        async changed => {
            const native = await nativeShippingFixture();
            if (changed === 'revision')
                await db
                    .getRepository(ContentTranslationState)
                    .update(native.state.id, { revision: native.state.revision + 1 });
            else
                await db
                    .getRepository(ShippingMethodTranslation)
                    .update(changed === 'source' ? native.source.id : native.target.id, {
                        name: changed === 'source' ? '更新中文' : 'Different native English',
                    });
            await expect(service.confirm(ctx, native.input)).rejects.toThrow('复核期间已变化');
            expect(
                await db.getRepository(ContentTranslationState).findOneByOrFail({ id: native.state.id }),
            ).toMatchObject({ status: 'STALE', locked: true });
        },
    );
    it('retains native review CAS protection if audit state changes after the locked snapshot read', async () => {
        const native = await nativeShippingFixture();
        const load = adapter.loadForReview.bind(adapter);
        vi.spyOn(adapter, 'loadForReview').mockImplementationOnce(async (manager, record, lock) => {
            const snapshot = await load(manager, record, lock);
            await manager
                .getRepository(ContentTranslationState)
                .update(record.id, { revision: record.revision + 1 });
            return snapshot;
        });
        await expect(service.confirm(ctx, native.input)).rejects.toThrow('复核状态已变化');
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: native.state.id }),
        ).toEqual(native.state);
        expect(
            (await db.getRepository(ShippingMethodTranslation).findOneByOrFail({ id: native.target.id }))
                .name,
        ).toBe(native.target.name);
    });
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

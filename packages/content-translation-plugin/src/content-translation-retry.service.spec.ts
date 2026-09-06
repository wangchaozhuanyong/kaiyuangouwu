import 'reflect-metadata';
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationRetryService } from './content-translation-retry.service.js';
import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationProviderError } from './translation-provider-error.js';

@Entity()
class StorefrontContentItem {
    @PrimaryGeneratedColumn() id: number;
    @Column('int') channelId: number;
    @OneToMany(() => ItemTranslation, translation => translation.base) translations: ItemTranslation[];
}
@Entity()
class ItemTranslation {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') languageCode: string;
    @Column('varchar') label: string;
    @Column('varchar', { default: '' }) description: string;
    @ManyToOne(() => StorefrontContentItem, item => item.translations) base: StorefrontContentItem;
}

// A generated primary key is normally installed by Vendure bootstrap. This database is memory-only.
PrimaryGeneratedColumn()(ContentTranslationState.prototype, 'id');
let db: DataSource;
let source: ItemTranslation;
let target: ItemTranslation;
let state: ContentTranslationState;
let translate: ReturnType<typeof vi.fn>;
let service: ContentTranslationService;
let retry: ContentTranslationRetryService;

beforeEach(async () => {
    db = await new DataSource({
        type: 'sqljs',
        entities: [StorefrontContentItem, ItemTranslation, ContentTranslationState],
        synchronize: true,
    }).initialize();
    const item = await db.getRepository(StorefrontContentItem).save({ channelId: 1 });
    [source, target] = await db.getRepository(ItemTranslation).save([
        { base: item, languageCode: 'zh_Hans', label: '商业服务' },
        { base: item, languageCode: 'en', label: 'AI services' },
    ]);
    translate = vi
        .fn()
        .mockResolvedValue({ provider: 'test', translations: [{ key: 'label', text: 'Business services' }] });
    const connection = {
        rawConnection: db,
        getRepository: (_ctx: unknown, entity: any) => db.getRepository(entity),
    };
    service = new ContentTranslationService(connection as any, {
        provider: { name: 'test', isConfigured: () => true, translate },
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
        glossary: {},
    });
    state = await service.recordState({} as any, {
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
    retry = new ContentTranslationRetryService(connection as any, service);
});
afterEach(async () => {
    await db?.destroy();
});

describe('durable translation retry with an isolated SQL database', () => {
    it('resumes a failed refresh after restart without paying for the translation again', async () => {
        const notify = vi
            .spyOn(retry as any, 'notify')
            .mockRejectedValueOnce(new Error('index temporarily unavailable'));
        expect((await retry.retryPending()).deferred).toBe(1);
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({ status: 'TRANSLATING' });
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'Business services',
        );
        notify.mockResolvedValue(undefined);
        expect((await retry.retryPending()).translated).toBe(1);
        expect(translate).toHaveBeenCalledTimes(1);
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({ status: 'AUTO_TRANSLATED' });
    });

    it('fills pending English after a new service instance starts', async () => {
        expect(await retry.retryPending()).toEqual({ scanned: 1, translated: 1, deferred: 0 });
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: source.id })).label).toBe(
            '商业服务',
        );
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'Business services',
        );
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({ status: 'AUTO_TRANSLATED', locked: false, error: null });
        await retry.retryPending();
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('retains both language records and the durable pending state during a quota failure', async () => {
        translate.mockRejectedValue(new TranslationProviderError('RATE_LIMIT'));
        expect(await retry.retryPending()).toEqual({ scanned: 1, translated: 0, deferred: 1 });
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'AI services',
        );
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({ status: 'PENDING', locked: false });
    });

    it('does not overwrite a newer Chinese edit made while translation is running', async () => {
        translate.mockImplementation(async () => {
            await db.getRepository(ItemTranslation).update(source.id, { label: '新服务' });
            await db
                .getRepository(ContentTranslationState)
                .update(state.id, { sourceHash: contentTranslationInternals.hash('新服务') });
            return { translations: [{ key: 'label', text: 'Outdated response' }] };
        });
        expect((await retry.retryPending()).translated).toBe(0);
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'AI services',
        );
    });

    it('does not overwrite English manually edited during translation', async () => {
        translate.mockImplementation(async () => {
            await db.getRepository(ItemTranslation).update(target.id, { label: 'Reviewed services' });
            await db
                .getRepository(ContentTranslationState)
                .update(state.id, { status: 'MANUAL_LOCKED', origin: 'MANUAL', locked: true });
            return { translations: [{ key: 'label', text: 'Automatic response' }] };
        });
        expect((await retry.retryPending()).translated).toBe(0);
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'Reviewed services',
        );
    });

    it('does not translate a record attributed to another shop', async () => {
        await db.getRepository(ContentTranslationState).update(state.id, { channelId: '2' });
        expect((await retry.retryPending()).translated).toBe(0);
        expect(translate).not.toHaveBeenCalled();
        expect((await db.getRepository(ItemTranslation).findOneByOrFail({ id: target.id })).label).toBe(
            'AI services',
        );
    });
});

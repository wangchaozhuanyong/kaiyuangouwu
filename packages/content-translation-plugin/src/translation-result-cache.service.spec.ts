import { Logger, SettingsStoreEntry, TransactionalConnection } from '@vendure/core';
import 'reflect-metadata';
import { DataSource, PrimaryGeneratedColumn } from 'typeorm';
import { SqljsDriver } from 'typeorm/driver/sqljs/SqljsDriver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationService } from './content-translation.service.js';
import { TranslationProviderError } from './translation-provider-error.js';
import {
    TranslationResultCacheService,
    translationResultCacheKey,
} from './translation-result-cache.service.js';
import { ContentTranslationProvider, ContentTranslationRequest } from './types.js';

// Vendure bootstrap normally installs this key. Each test uses an isolated SQL.js database.
PrimaryGeneratedColumn()(SettingsStoreEntry.prototype, 'id');
let db: DataSource;
let cache: TranslationResultCacheService;
let provider: ContentTranslationProvider;
let translate: ReturnType<typeof vi.fn<ContentTranslationProvider['translate']>>;
const request = (text = '普通文具', key = 'name'): ContentTranslationRequest => ({
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    segments: [{ key, text }],
});
const connection = () => ({ rawConnection: db }) as TransactionalConnection;
const service = () =>
    new ContentTranslationService(
        connection(),
        { provider, sourceLanguageCode: 'zh_Hans', targetLanguageCode: 'en', glossary: {} },
        cache,
    );

beforeEach(async () => {
    db = await new DataSource({
        type: 'sqljs',
        entities: [SettingsStoreEntry],
        synchronize: true,
    }).initialize();
    let calls = 0;
    translate = vi.fn(input => {
        const call = ++calls;
        return Promise.resolve({
            provider: 'test',
            translations: input.segments.map((segment, index) => ({
                key: segment.key,
                text: `Translation ${call} item ${index}`,
            })),
        });
    });
    provider = { name: 'test', isConfigured: () => true, translate };
    cache = new TranslationResultCacheService(connection());
});

afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
});

describe('persistent translation result cache', () => {
    it('translates 362 repeated fields once and restores every caller field key', async () => {
        const segments = Array.from({ length: 362 }, (_, index) => ({
            key: `item-${index}`,
            text: '普通文具',
        }));
        const result = await cache.translate({ ...request(), segments }, provider);
        expect(translate).toHaveBeenCalledOnce();
        expect(translate.mock.calls[0][0].segments).toHaveLength(1);
        expect(result.translations).toEqual(
            segments.map(segment => ({ key: segment.key, text: 'Translation 1 item 0' })),
        );
        await expect(cache.translate(request('普通文具', 'other-field'), provider)).resolves.toMatchObject({
            translations: [{ key: 'other-field', text: 'Translation 1 item 0' }],
        });
        expect(translate).toHaveBeenCalledOnce();
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(1);
    });

    it('sends only uncached text in a partially cached batch', async () => {
        await cache.translate(request(), provider);
        const result = await cache.translate(
            {
                ...request(),
                segments: [
                    { key: 'old', text: '普通文具' },
                    { key: 'new', text: '新文具' },
                    { key: 'duplicate', text: '新文具' },
                ],
            },
            provider,
        );
        expect(translate.mock.calls[1][0].segments.map(segment => segment.text)).toEqual(['新文具']);
        expect(result.translations).toEqual([
            { key: 'old', text: 'Translation 1 item 0' },
            { key: 'new', text: 'Translation 2 item 0' },
            { key: 'duplicate', text: 'Translation 2 item 0' },
        ]);
    });

    it('reuses the persisted result after reopening the database and creating a new cache instance', async () => {
        await cache.translate(request(), provider);
        const database = (db.driver as SqljsDriver).export();
        await db.destroy();
        db = await new DataSource({ type: 'sqljs', database, entities: [SettingsStoreEntry] }).initialize();
        cache = new TranslationResultCacheService(connection());
        await cache.translate(request('普通文具', 'different-record'), provider);
        expect(translate).toHaveBeenCalledOnce();
    });

    it('coalesces concurrent cache misses in one process', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        translate.mockImplementation(async input => {
            await gate;
            return {
                provider: 'test',
                translations: input.segments.map(segment => ({ key: segment.key, text: 'Stationery' })),
            };
        });
        const pending = Array.from({ length: 20 }, (_, index) =>
            cache.translate(request('普通文具', String(index)), provider),
        );
        await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
        release();
        const results = await Promise.all(pending);
        expect(results.every(result => result.translations[0].text === 'Stationery')).toBe(true);
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(1);
    });

    it('serves cached text before checking provider configuration, including through the save service', async () => {
        await cache.translate(request(), provider);
        provider.isConfigured = () => false;
        const [field] = await service().prepareLocalizedFields([{ path: 'title', sourceText: '普通文具' }]);
        expect(field).toMatchObject({ translatedText: 'Translation 1 item 0', status: 'AUTO_TRANSLATED' });
        await expect(cache.translate(request('未缓存'), provider)).rejects.toMatchObject({
            code: 'CONFIGURATION',
        });
        expect(translate).toHaveBeenCalledOnce();
    });

    it('keeps cached text available while new text hits a quota error', async () => {
        await cache.translate(request(), provider);
        translate.mockRejectedValue(new TranslationProviderError('RATE_LIMIT'));
        const failed = cache.translate(
            {
                ...request(),
                segments: [
                    { key: 'cached', text: '普通文具' },
                    { key: 'missing', text: '未缓存' },
                ],
            },
            provider,
        );
        const cached = cache.translate(request('普通文具', 'cached-only'), provider);
        await expect(failed).rejects.toMatchObject({ code: 'RATE_LIMIT' });
        await expect(cached).resolves.toMatchObject({
            translations: [{ key: 'cached-only', text: 'Translation 1 item 0' }],
        });
    });

    it('saves cached English when another field in the same save cannot be translated', async () => {
        await cache.translate(request(), provider);
        translate.mockRejectedValue(new TranslationProviderError('RATE_LIMIT'));
        const fields = await service().prepareLocalizedFields([
            { path: 'name', sourceText: '普通文具' },
            { path: 'description', sourceText: '尚未缓存的新说明' },
            { path: 'shortLabel', sourceText: '普通文具', maxTargetLength: 5, existingTargetText: 'Old' },
        ]);
        expect(fields[0]).toMatchObject({
            translatedText: 'Translation 1 item 0',
            status: 'AUTO_TRANSLATED',
        });
        expect(fields[1]).toMatchObject({ translatedText: '', status: 'PENDING' });
        expect(fields[2]).toMatchObject({
            translatedText: 'Old',
            status: 'PENDING',
            error: expect.stringContaining('长度限制'),
        });
        expect(translate.mock.calls[1][0].segments.map(segment => segment.text)).toEqual([
            '尚未缓存的新说明',
        ]);
    });

    it('does not cache provider failures and retries a later successful request', async () => {
        translate.mockRejectedValueOnce(new TranslationProviderError('RATE_LIMIT'));
        await expect(cache.translate(request(), provider)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
        await cache.translate(request(), provider);
        await cache.translate(request(), provider);
        expect(translate).toHaveBeenCalledTimes(2);
    });

    it.each(['', '   ', '仍然是中文'])('does not cache invalid translation %j', async text => {
        translate.mockImplementationOnce(input =>
            Promise.resolve({
                provider: 'test',
                translations: input.segments.map(segment => ({ key: segment.key, text })),
            }),
        );
        await expect(cache.translate(request(), provider)).rejects.toMatchObject({
            code: 'INVALID_RESPONSE',
        });
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
        await cache.translate(request(), provider);
        expect(translate).toHaveBeenCalledTimes(2);
    });

    it('does not cache incomplete provider responses', async () => {
        translate.mockResolvedValueOnce({ provider: 'test', translations: [] });
        await expect(cache.translate(request(), provider)).rejects.toMatchObject({
            code: 'INVALID_RESPONSE',
        });
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
    });

    it('separates source text, text format, provider and glossary changes', async () => {
        await cache.translate(request(), provider);
        await cache.translate(request('新原文'), provider);
        await cache.translate(
            { ...request(), segments: [{ ...request().segments[0], format: 'HTML' }] },
            provider,
        );
        await cache.translate(request(), { ...provider, name: 'different-provider' });
        await cache.translate({ ...request(), glossary: { 文具: 'Supplies' } }, provider);
        expect(translate).toHaveBeenCalledTimes(5);
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(5);
    });

    it('canonicalizes equivalent glossary entries for both the cache and the provider', async () => {
        await cache.translate({ ...request(), glossary: { B: 'Second', A: 'First' } }, provider);
        await cache.translate({ ...request(), glossary: { A: 'First', B: 'Second' } }, provider);
        expect(translate).toHaveBeenCalledOnce();
        expect(Object.keys(translate.mock.calls[0][0].glossary ?? {})).toEqual(['A', 'B']);
    });

    it('preserves exact source whitespace and markup in the cache identity', async () => {
        await cache.translate(request('文字'), provider);
        await cache.translate(request(' 文字'), provider);
        await cache.translate(request('<b>文字</b>'), provider);
        expect(translate).toHaveBeenCalledTimes(3);
    });

    it('never shares manually locked English as an automatic cached translation', async () => {
        const [manual] = await service().prepareLocalizedFields([
            { path: 'name', sourceText: '普通文具', targetText: 'My reviewed brand', manualLock: true },
        ]);
        expect(manual).toMatchObject({ translatedText: 'My reviewed brand', status: 'MANUAL_LOCKED' });
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
        const [automatic] = await service().prepareLocalizedFields([
            { path: 'other', sourceText: '普通文具' },
        ]);
        expect(automatic.translatedText).toBe('Translation 1 item 0');
    });

    it('reuses unchanged existing English without a request or assuming its historical translation rules', async () => {
        const [field] = await service().prepareLocalizedFields([
            {
                path: 'name',
                sourceText: '普通文具',
                targetText: 'Existing stationery',
                existingSourceText: '普通文具',
                existingTargetText: 'Existing stationery',
                manualLock: false,
                existingLocked: false,
            },
        ]);
        expect(field).toMatchObject({ translatedText: 'Existing stationery', status: 'AUTO_TRANSLATED' });
        expect(translate).not.toHaveBeenCalled();
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
    });

    it('still validates the destination length when a translation comes from the cache', async () => {
        await cache.translate(request(), provider);
        const [field] = await service().prepareLocalizedFields([
            { path: 'shortName', sourceText: '普通文具', maxTargetLength: 5, existingTargetText: 'Old' },
        ]);
        expect(field).toMatchObject({ translatedText: 'Old', status: 'PENDING' });
        expect(translate).toHaveBeenCalledOnce();
    });

    it('replaces invalid stored values rather than treating them as usable translations', async () => {
        await cache.translate(request(), provider);
        const existing = await db
            .getRepository(SettingsStoreEntry)
            .findOneByOrFail({ key: translationResultCacheKey });
        await db.getRepository(SettingsStoreEntry).save({ ...existing, value: { text: '中文' } });
        await cache.translate(request(), provider);
        expect(translate).toHaveBeenCalledTimes(2);
        const [entry] = await db.getRepository(SettingsStoreEntry).find();
        expect(entry.value).toEqual({ text: 'Translation 2 item 0' });
    });

    it('does not call the provider for an empty request', async () => {
        await expect(cache.translate({ ...request(), segments: [] }, provider)).resolves.toEqual({
            provider: 'test',
            translations: [],
        });
        expect(translate).not.toHaveBeenCalled();
    });

    it('keeps Chinese pending without sending extra requests when the cache cannot be read', async () => {
        vi.spyOn(db.getRepository(SettingsStoreEntry), 'find').mockRejectedValueOnce(
            new Error('cache offline'),
        );
        const [field] = await service().prepareLocalizedFields([
            { path: 'name', sourceText: '普通文具', existingTargetText: 'Old name' },
        ]);
        expect(field).toMatchObject({
            sourceText: '普通文具',
            translatedText: 'Old name',
            status: 'PENDING',
        });
        expect(translate).not.toHaveBeenCalled();
    });

    it('preserves a valid result if cache storage fails without claiming it was persisted', async () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        vi.spyOn(db.getRepository(SettingsStoreEntry), 'upsert').mockRejectedValueOnce(
            new Error('cache full'),
        );
        await expect(cache.translate(request(), provider)).resolves.toMatchObject({
            translations: [{ key: 'name', text: 'Translation 1 item 0' }],
        });
        expect(await db.getRepository(SettingsStoreEntry).count()).toBe(0);
        expect(warn).toHaveBeenCalledOnce();
        await cache.translate(request(), provider);
        expect(translate).toHaveBeenCalledTimes(2);
    });
});

import { Injectable } from '@nestjs/common';
import { isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';
import { Logger, SettingsStoreEntry, TransactionalConnection } from '@vendure/core';
import { createHash } from 'node:crypto';
import { In } from 'typeorm';

import { contentTranslationLoggerCtx } from './constants.js';
import { PartialTranslationProviderError, TranslationProviderError } from './translation-provider-error.js';
import { ContentTranslationProvider, ContentTranslationRequest, ContentTranslationSegment } from './types.js';

export const translationResultCacheKey = 'contentTranslationCache.result';

export class CachedTranslationPartialError extends TranslationProviderError {
    constructor(
        failure: TranslationProviderError,
        readonly translations: Array<{ key: string; text: string }>,
    ) {
        super(failure.code, failure.retryAfterMs);
    }
}

type CachedTranslationEntry = Omit<SettingsStoreEntry, 'value'> & { value: { text: string } | null };

interface PendingTranslation {
    scope: string;
    segment: ContentTranslationSegment;
    resolve: (text: string) => void;
    reject: (error: unknown) => void;
}

/** Shared SQL results survive API/worker restarts; in-flight requests are coalesced per process. */
@Injectable()
export class TranslationResultCacheService {
    private readonly inFlight = new Map<string, Promise<string>>();

    constructor(private readonly connection: TransactionalConnection) {}

    /** Business saves may read existing results, but must never invoke the provider. */
    async lookup(request: ContentTranslationRequest, providerName: string) {
        const normalized = { ...request, glossary: canonicalGlossary(request.glossary) };
        const scopes = request.segments.map(segment => resultScope(normalized, providerName, segment));
        const uniqueScopes = [...new Set(scopes)];
        const cached = new Map<string, string>();
        const repository =
            this.connection.rawConnection.getRepository<CachedTranslationEntry>(SettingsStoreEntry);
        for (let offset = 0; offset < uniqueScopes.length; offset += 200) {
            const rows = await repository
                .find({
                    where: {
                        key: translationResultCacheKey,
                        scope: In(uniqueScopes.slice(offset, offset + 200)),
                    },
                })
                .catch(() => {
                    throw new TranslationProviderError('UNAVAILABLE');
                });
            for (const row of rows) {
                const value: unknown = row.value;
                if (
                    row.scope &&
                    typeof value === 'object' &&
                    value !== null &&
                    'text' in value &&
                    isUsableEnglishTranslation(value.text)
                )
                    cached.set(row.scope, value.text.trim());
            }
        }
        return request.segments.flatMap((segment, index) => {
            const text = cached.get(scopes[index]);
            return text === undefined ? [] : [{ key: segment.key, text }];
        });
    }

    async translate(request: ContentTranslationRequest, provider: ContentTranslationProvider) {
        // Canonicalize both the cache identity and the actual provider input.
        const glossary = canonicalGlossary(request.glossary);
        const normalized = { ...request, glossary };
        const owned: PendingTranslation[] = [];
        const pending = request.segments.map(segment => {
            const scope = resultScope(normalized, provider.name, segment);
            let promise = this.inFlight.get(scope);
            if (!promise) {
                promise = new Promise<string>((resolve, reject) => {
                    owned.push({ scope, segment, resolve, reject });
                });
                this.inFlight.set(scope, promise);
                const release = () => this.inFlight.delete(scope);
                void promise.then(release, release);
            }
            return promise.then(text => ({ key: segment.key, text }));
        });
        if (owned.length) void this.resolveOwned(normalized, provider, owned);
        const outcomes = await Promise.allSettled(pending);
        const failures = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
        const translations = outcomes.flatMap(item => (item.status === 'fulfilled' ? [item.value] : []));
        if (failures.length) {
            // Preserve programming errors; a provider failure may still leave valid cached fields available.
            const failure =
                failures.find(item => !(item.reason instanceof TranslationProviderError)) ?? failures[0];
            if (failure.reason instanceof TranslationProviderError && translations.length)
                throw new CachedTranslationPartialError(failure.reason, translations);
            throw failure.reason;
        }
        return { provider: provider.name, translations };
    }

    private async resolveOwned(
        request: ContentTranslationRequest,
        provider: ContentTranslationProvider,
        owned: PendingTranslation[],
    ) {
        try {
            const repository =
                this.connection.rawConnection.getRepository<CachedTranslationEntry>(SettingsStoreEntry);
            const cached = new Map(
                (
                    await this.lookup(
                        {
                            ...request,
                            segments: owned.map(item => ({ ...item.segment, key: item.scope })),
                        },
                        provider.name,
                    )
                ).map(item => [item.key, item.text]),
            );
            const missing: PendingTranslation[] = [];
            for (const item of owned) {
                const text = cached.get(item.scope);
                if (text !== undefined) item.resolve(text);
                else missing.push(item);
            }
            // Cached translations remain usable during cooldowns, quota failures or missing credentials.
            if (!missing.length) return;
            if (!provider.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
            let partialFailure: PartialTranslationProviderError | undefined;
            const result = await provider
                .translate({
                    ...request,
                    segments: missing.map(item => ({ ...item.segment, key: item.scope })),
                })
                .catch((error: unknown) => {
                    if (!(error instanceof PartialTranslationProviderError)) throw error;
                    partialFailure = error;
                    return { provider: provider.name, translations: error.translations };
                });
            const values = missing.flatMap(item => {
                const matches = result.translations.filter(translation => translation.key === item.scope);
                const text = matches[0]?.text;
                if (partialFailure && matches.length === 0) return [];
                if (matches.length !== 1 || !isUsableEnglishTranslation(text))
                    throw new TranslationProviderError('INVALID_RESPONSE');
                return [{ item, text: text.trim() }];
            });
            // Only valid automatic results enter the shared cache. Manual English stays on its own record.
            try {
                for (let offset = 0; offset < values.length; offset += 200) {
                    await repository.upsert(
                        values.slice(offset, offset + 200).map(({ item, text }) => ({
                            key: translationResultCacheKey,
                            scope: item.scope,
                            value: { text },
                        })),
                        ['key', 'scope'],
                    );
                }
            } catch {
                Logger.warn('翻译已完成，但共享缓存暂时写入失败', contentTranslationLoggerCtx);
            }
            for (const { item, text } of values) item.resolve(text);
            if (partialFailure) {
                const completed = new Set(values.map(value => value.item.scope));
                for (const item of missing) if (!completed.has(item.scope)) item.reject(partialFailure);
            }
        } catch (error) {
            // Do not cache failed requests, empty results or untranslated Chinese.
            for (const item of owned) item.reject(error);
        }
    }
}

function canonicalGlossary(glossary: ContentTranslationRequest['glossary']) {
    return Object.fromEntries(
        Object.entries(glossary ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
}

function resultScope(
    request: Omit<ContentTranslationRequest, 'segments'>,
    provider: string,
    segment: ContentTranslationSegment,
) {
    return createHash('sha256')
        .update(
            JSON.stringify([
                1,
                provider,
                request.sourceLanguageCode,
                request.targetLanguageCode,
                segment.format ?? 'TEXT',
                segment.text,
                request.glossary,
            ]),
        )
        .digest('hex');
}

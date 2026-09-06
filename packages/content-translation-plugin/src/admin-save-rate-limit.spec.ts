import {
    Collection,
    Country,
    Facet,
    FacetValue,
    PaymentMethod,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductVariant,
    Promotion,
    Province,
    ShippingMethod,
    type RequestContext,
    type TransactionalConnection,
} from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { NativeContentTranslationService } from './native-content-translation.service.js';
import { GoogleCloudTranslationProvider } from './providers/google-cloud-translation.provider.js';

// Cross-module regression for the admin screenshot's Google 403 response. Repositories are in-memory
// doubles; the provider, localized preparation, native translation, and state recording are real code.
const ctx = { channelId: '1' } as RequestContext;
const entities = [
    Product,
    ProductVariant,
    ProductOptionGroup,
    ProductOption,
    Collection,
    Facet,
    FacetValue,
    Promotion,
    ShippingMethod,
    PaymentMethod,
    Country,
    Province,
];
const customFields = [
    ['StoreProfile', 'description'],
    ['SystemAnnouncement', 'title'],
    ['AutoCardConfig', 'instructions'],
    ['StorefrontReview', 'merchantResponse'],
    ['AfterSalesRequest', 'resolution'],
    ['ImageGenerationConfig', 'terms'],
    ['ImageModelConfig', 'displayName'],
    ['ReferralPosterTemplate', 'title'],
    ['StorefrontContentBlock', 'title'],
    ['StorefrontContentItem', 'label'],
];

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function fixture(existingEnglish = false, provider?: GoogleCloudTranslationProvider) {
    const source = {
        languageCode: 'zh_Hans',
        name: '新客优惠活动',
        slug: 'xin-ke',
        description: '<p>活动详情</p>',
    };
    const target = existingEnglish
        ? {
              languageCode: 'en',
              name: 'Previous English',
              slug: 'previous-english',
              description: '<p>Previous details</p>',
          }
        : null;
    const recorded: ContentTranslationState[] = [];
    const stateRepository = {
        find: vi.fn(() =>
            Promise.resolve(
                target
                    ? Object.entries(target)
                          .filter(([field]) => field !== 'languageCode')
                          .map(([fieldPath, text]) => ({
                              fieldPath,
                              sourceHash: contentTranslationInternals.hash('旧中文'),
                              translatedHash: contentTranslationInternals.hash(text),
                              status: 'AUTO_TRANSLATED',
                              locked: false,
                          }))
                    : [],
            ),
        ),
        findOne: vi.fn(() => Promise.resolve(null)),
        save: vi.fn((value: ContentTranslationState) => {
            recorded.push(value);
            return Promise.resolve(value);
        }),
    };
    const repository = {
        create: vi.fn((value: object) => value),
        save: vi.fn((value: object) => Promise.resolve(value)),
        createQueryBuilder: vi.fn(() => {
            let languageCode = '';
            const builder = {
                leftJoinAndSelect: vi.fn(() => builder),
                where: vi.fn(() => builder),
                andWhere: vi.fn((_query: string, parameters: { languageCode: string }) => {
                    languageCode = parameters.languageCode;
                    return builder;
                }),
                getOne: vi.fn(() => Promise.resolve(languageCode === 'zh_Hans' ? source : target)),
            };
            return builder;
        }),
    };
    const connection = {
        rawConnection: {
            getMetadata: () => ({
                relations: [
                    { propertyName: 'translations', inverseEntityMetadata: { target: class Translation {} } },
                ],
            }),
        },
        getRepository: (_ctx: unknown, entity: unknown) =>
            entity === ContentTranslationState ? stateRepository : repository,
    } as unknown as TransactionalConnection;
    const fetchMock = vi.fn(() =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    error: {
                        message: 'User Rate Limit Exceeded',
                        errors: [{ reason: 'userRateLimitExceeded' }],
                    },
                }),
                { status: 403, headers: { 'content-type': 'application/json' } },
            ),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const translations = new ContentTranslationService(connection, {
        provider: provider ?? new GoogleCloudTranslationProvider({ apiKey: 'test-only-placeholder' }),
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
        glossary: {},
    });
    const native = new NativeContentTranslationService({} as never, connection, translations);
    return { source, target, recorded, repository, translations, native, fetchMock };
}

describe('admin saves survive the shared Google translation rate limit', () => {
    for (const Entity of entities) {
        it.each([false, true])(
            `${Entity.name}: preserves a save with existing English = %s`,
            async existingEnglish => {
                const f = fixture(existingEnglish);
                const sourceBefore = { ...f.source };
                await expect(
                    f.native.translateEntity(ctx, new Entity({ id: 'entity-1' }), {
                        translations: [f.source],
                    }),
                ).resolves.toBe(false);
                expect(f.source).toEqual(sourceBefore);
                expect(f.repository.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        languageCode: 'en',
                        name: existingEnglish ? 'Previous English' : '',
                    }),
                    { reload: false },
                );
                expect(f.recorded).toContainEqual(
                    expect.objectContaining({
                        entityType: Entity.name,
                        entityId: 'entity-1',
                        fieldPath: 'name',
                        status: 'PENDING',
                        origin: 'AUTO',
                        locked: false,
                    }),
                );
                expect(f.fetchMock).toHaveBeenCalledTimes(1);
            },
        );
    }

    it.each(customFields)(
        '%s.%s: preserves Chinese and records pending English',
        async (entityType, path) => {
            const f = fixture();
            const prepared = await f.translations.prepareLocalizedFields([
                {
                    path,
                    sourceText: '新内容',
                    existingSourceText: '旧内容',
                    existingTargetText: 'Previous English',
                },
            ]);
            expect(prepared).toEqual([
                expect.objectContaining({
                    sourceText: '新内容',
                    translatedText: 'Previous English',
                    status: 'PENDING',
                    locked: false,
                }),
            ]);
            await f.translations.recordPreparedFields(
                ctx,
                { channelId: '1', entityType, entityId: 'custom-1' },
                prepared,
            );
            expect(f.recorded).toContainEqual(
                expect.objectContaining({ entityType, fieldPath: path, status: 'PENDING' }),
            );
        },
    );

    it('shares the cooldown across coupon and product saves, then retries after recovery', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await f.native.translateEntity(ctx, new Promotion({ id: 'coupon-1' }), { translations: [f.source] });
        await f.native.translateEntity(ctx, new Product({ id: 'product-1' }), { translations: [f.source] });
        expect(f.fetchMock).toHaveBeenCalledTimes(1);
        expect(
            new Set(f.recorded.filter(row => row.status === 'PENDING').map(row => row.entityType)),
        ).toEqual(new Set(['Promotion', 'Product']));

        vi.advanceTimersByTime(60_000);
        f.fetchMock.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    data: {
                        translations: [
                            { translatedText: 'Welcome offer' },
                            { translatedText: 'Offer details' },
                        ],
                    },
                }),
                { status: 200 },
            ),
        );
        await f.native.translateEntity(ctx, new Promotion({ id: 'coupon-1' }), { translations: [f.source] });
        expect(f.repository.save).toHaveBeenLastCalledWith(
            expect.objectContaining({ name: 'Welcome offer' }),
            { reload: false },
        );
        expect(f.fetchMock).toHaveBeenCalledTimes(2);
    });

    it('still rejects missing required Chinese instead of hiding a real validation error', async () => {
        const f = fixture();
        f.source.name = '';
        await expect(
            f.native.translateEntity(ctx, new Promotion({ id: 'coupon-1' }), {
                translations: [f.source],
            }),
        ).rejects.toThrow('Simplified Chinese');
        expect(f.repository.save).not.toHaveBeenCalled();
        expect(f.fetchMock).not.toHaveBeenCalled();
    });
});

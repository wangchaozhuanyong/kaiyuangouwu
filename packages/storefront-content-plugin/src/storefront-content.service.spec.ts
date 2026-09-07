import { LanguageCode } from '@vendure/common/lib/generated-types';
import { isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';
import 'reflect-metadata';
import { Not } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { createContentPublicationChecker } from './content-publication';
import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentSettings } from './entities/storefront-content-settings.entity';
import { StorefrontContentService } from './storefront-content.service';
import { CreateStorefrontContentBlockInput } from './types';
import { STOREFRONT_VISUAL_PRESET_CODE } from './visual-presets';

const contentPublicationStatus = createContentPublicationChecker(isUsableEnglishTranslation);

function createInput(
    overrides: Partial<CreateStorefrontContentBlockInput> = {},
): CreateStorefrontContentBlockInput {
    return {
        code: 'homepage-hero',
        type: 'HERO',
        enabled: true,
        position: 0,
        targetType: 'URL',
        targetValue: '#/category',
        translations: [{ languageCode: LanguageCode.zh_Hans, title: '首页主图' }],
        ...overrides,
    };
}

function validate(input: CreateStorefrontContentBlockInput) {
    const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
    return (service as any).validateBlockInput(input);
}

describe('StorefrontContentService input validation', () => {
    it('normalizes codes, optional text, dates, and internal targets', () => {
        const result = validate(
            createInput({
                code: '  homepage-hero  ',
                startsAt: new Date('2026-08-14T00:00:00.000Z'),
                endsAt: new Date('2026-08-15T00:00:00.000Z'),
                imageUrl: '  /assets/hero.jpg  ',
                backgroundColor: '#ffffff',
            }),
        );

        expect(result).toMatchObject({
            code: 'homepage-hero',
            internalName: '首页主图',
            layoutVariant: 'AUTO',
            targetValue: '#/category',
            imageUrl: '/assets/hero.jpg',
            backgroundColor: '#ffffff',
        });
    });

    it('stores an explicit internal name, layout, and flat module settings', () => {
        const result = validate(
            createInput({
                internalName: ' 首页顶部轮播 ',
                layoutVariant: 'HERO_OVERLAY',
                settings: { displayCount: 6, showMore: true, pinnedProductIds: ['1', '2'] },
            }),
        );

        expect(result).toMatchObject({
            internalName: '首页顶部轮播',
            layoutVariant: 'HERO_OVERLAY',
            settings: { displayCount: 6, showMore: true, pinnedProductIds: ['1', '2'] },
        });
        expect(() => validate(createInput({ settings: [] as never }))).toThrow(/模块设置格式/);
    });

    it('rejects invalid schedules and colors', () => {
        expect(() =>
            validate(
                createInput({
                    startsAt: new Date('2026-08-15T00:00:00.000Z'),
                    endsAt: new Date('2026-08-14T00:00:00.000Z'),
                }),
            ),
        ).toThrow(/结束时间/);
        expect(() => validate(createInput({ textColor: 'red' }))).toThrow(/六位十六进制颜色/);
    });

    it('rejects duplicate translations and unsafe links', () => {
        expect(() =>
            validate(
                createInput({
                    translations: [
                        { languageCode: LanguageCode.en, title: 'Hero' },
                        { languageCode: LanguageCode.en, title: 'Duplicate' },
                    ],
                }),
            ),
        ).toThrow(/同一种语言不能重复/);
        expect(() =>
            validate(createInput({ targetType: 'URL', targetValue: 'javascript:alert(1)' })),
        ).toThrow(/HTTP\(S\)/);
    });

    it('accepts importable external images and rejects unmanaged local image paths', () => {
        expect(() =>
            validate(createInput({ imageUrl: 'https://images.example.com/storefront/hero.png' })),
        ).not.toThrow();
        expect(() => validate(createInput({ imageUrl: '/legacy/hero.png' }))).toThrow(/素材库/);
    });

    it('requires coupon blocks to point to real promotion codes', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const couponItem = {
            position: 0,
            targetType: 'COUPON' as const,
            targetValue: 'WELCOME15',
            translations: [{ languageCode: LanguageCode.zh_Hans, label: '8.5折' }],
        };

        expect(() => (service as any).validateItemInput(couponItem, 'COUPONS')).not.toThrow();
        expect(() =>
            (service as any).validateItemInput(
                { ...couponItem, targetType: 'URL', targetValue: 'https://example.com' },
                'COUPONS',
            ),
        ).toThrow(/必须填写优惠码/);
    });

    it('reserves one stable code and a complete design shape for each auth page visual', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const authInput = createInput({
            code: 'auth-login-visual',
            type: 'AUTH_LOGIN',
            layoutVariant: 'HERO_OVERLAY',
            targetType: 'NONE',
            targetValue: null,
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    title: '登录你的 AI 新世界',
                    subtitle: '创作、编程与办公工具，一站高效管理',
                    ctaLabel: 'AI 软件精选平台',
                },
            ],
            settings: { accentColor: '#67e8f9' },
            items: [0, 1, 2].map(position => ({
                enabled: true,
                position,
                targetType: 'NONE' as const,
                targetValue: null,
                translations: [{ languageCode: LanguageCode.zh_Hans, label: `卖点 ${String(position + 1)}` }],
            })),
        });
        const normalized = validate(authInput);

        expect(() => (service as any).validateAuthVisual(normalized, authInput.items)).not.toThrow();
        expect(() => validate({ ...authInput, code: 'another-login-visual' })).toThrow(/系统保留编码/);
        expect(() =>
            (service as any).validateAuthVisual(normalized, authInput.items?.slice(0, 2) ?? []),
        ).not.toThrow();
        expect(() =>
            (service as any).validateAuthVisual(
                { ...normalized, settings: { accentColor: 'cyan' } },
                authInput.items,
            ),
        ).toThrow(/强调色/);
    });

    it('reserves one system code for the storefront navigation block', () => {
        expect(() =>
            validate(
                createInput({
                    code: 'another-navigation',
                    type: 'NAVIGATION',
                    targetType: 'NONE',
                    targetValue: null,
                }),
            ),
        ).toThrow(/系统保留编码/);

        expect(() =>
            validate(
                createInput({
                    code: 'storefront-navigation',
                    type: 'NAVIGATION',
                    targetType: 'NONE',
                    targetValue: null,
                }),
            ),
        ).not.toThrow();
        expect(() =>
            validate(
                createInput({
                    code: 'storefront-navigation',
                    type: 'CUSTOM',
                    targetType: 'NONE',
                    targetValue: null,
                }),
            ),
        ).toThrow(/系统保留编码/);
    });

    it('limits navigation configuration to five supported internal pages', async () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const item = (position: number, targetValue = '/') => ({
            enabled: true,
            position,
            targetType: 'PAGE' as const,
            targetValue,
            translations: [{ languageCode: LanguageCode.zh_Hans, label: '导航 ' + String(position + 1) }],
        });

        await expect(
            (service as any).syncItems(
                { channelId: 'store-a' },
                { type: 'NAVIGATION' },
                Array.from({ length: 6 }, (_, index) => item(index)),
            ),
        ).rejects.toThrow(/1 到 5/);
        await expect(
            (service as any).syncItems({ channelId: 'store-a' }, { type: 'NAVIGATION' }, [item(0, '/admin')]),
        ).rejects.toThrow(/不支持的站内页面/);
        expect(() => (service as any).validateNavigationItems([item(0, '/services')])).not.toThrow();
    });

    it('reserves and validates the category client plugin layout', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const pluginItem = (pluginCode: string, placement = 'BEFORE_PRODUCT_LIST') => ({
            enabled: true,
            position: 0,
            targetType: 'NONE' as const,
            targetValue: null,
            settings: { pluginCode, placement },
            translations: [{ languageCode: LanguageCode.zh_Hans, label: pluginCode }],
        });

        expect(() =>
            validate(
                createInput({
                    code: 'storefront-client-plugins',
                    type: 'CLIENT_PLUGINS',
                    targetType: 'NONE',
                    targetValue: null,
                }),
            ),
        ).not.toThrow();
        expect(() =>
            validate(
                createInput({
                    code: 'another-client-plugin-layout',
                    type: 'CLIENT_PLUGINS',
                    targetType: 'NONE',
                    targetValue: null,
                }),
            ),
        ).toThrow(/系统保留编码/);
        expect(() =>
            (service as any).validateClientPluginItems([
                pluginItem('category-coupon-entry'),
                pluginItem('category-coupon-entry'),
            ]),
        ).toThrow(/不能重复添加/);
        expect(() =>
            (service as any).validateClientPluginItems([
                pluginItem('category-coupon-entry', 'INSIDE_PRODUCT_CARD'),
            ]),
        ).toThrow(/不支持的分类页位置/);
        expect(() => (service as any).validateClientPluginItems([pluginItem('not-released')])).toThrow(
            /尚未在平台发布/,
        );
        expect(() =>
            (service as any).validateClientPluginItems([
                { ...pluginItem('category-coupon-entry'), targetType: 'URL', targetValue: '/coupons' },
            ]),
        ).toThrow(/不能配置独立跳转目标/);
        expect(() =>
            (service as any).validateClientPluginItems([
                {
                    ...pluginItem('category-coupon-entry'),
                    settings: {
                        pluginCode: 'category-coupon-entry',
                        placement: 'BEFORE_PRODUCT_LIST',
                        categoryScope: 'SELECTED',
                        categoryIds: [],
                        includeChildren: true,
                    },
                },
            ]),
        ).toThrow(/至少需要选择一个分类/);
        expect(() =>
            (service as any).validateClientPluginItems([
                {
                    ...pluginItem('category-coupon-entry'),
                    settings: {
                        pluginCode: 'category-coupon-entry',
                        placement: 'BUSINESS_SERVICES_MAIN',
                        categoryScope: 'SELECTED',
                        categoryIds: [],
                        includeChildren: true,
                    },
                },
            ]),
        ).not.toThrow();
        expect(() =>
            (service as any).validateClientPluginItems([
                {
                    ...pluginItem('category-coupon-entry'),
                    settings: {
                        pluginCode: 'category-coupon-entry',
                        placement: 'BEFORE_PRODUCT_LIST',
                        categoryScope: 'SELECTED',
                        categoryIds: ['collection-1'],
                        includeChildren: true,
                    },
                },
            ]),
        ).not.toThrow();
    });
});

describe('StorefrontContentService publication guard', () => {
    it('publishes cleared auth copy in Chinese while nonempty English copy is pending', () => {
        const block = {
            type: 'AUTH_LOGIN',
            enabled: true,
            translations: [{ languageCode: 'zh_Hans', title: '', subtitle: '欢迎回来' }],
            items: [{ enabled: true, translations: [{ languageCode: 'zh_Hans', label: '' }] }],
        };
        expect(contentPublicationStatus(block, Date.now(), 'zh_Hans')).toBe('PUBLISHED');
        expect(contentPublicationStatus(block, Date.now(), 'en')).toBe('INCOMPLETE_TRANSLATION');
        block.translations.push({ languageCode: 'en', title: '', subtitle: 'Welcome back' });
        block.items[0].translations.push({ languageCode: 'en', label: '' });
        expect(contentPublicationStatus(block, Date.now(), 'en')).toBe('PUBLISHED');
        expect(contentPublicationStatus({ ...block, type: 'CORE_CATEGORIES' }, Date.now(), 'zh_Hans')).toBe(
            'INCOMPLETE_TRANSLATION',
        );
    });

    it('requires matching Chinese and English customer-visible fields', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const block = new StorefrontContentBlock({
            translations: [
                { languageCode: LanguageCode.zh_Hans, title: '首页', subtitle: '', body: '', ctaLabel: '' },
                { languageCode: LanguageCode.en, title: '', subtitle: '', body: '', ctaLabel: '' },
            ],
            items: [],
        });

        expect(contentPublicationStatus({ ...block, enabled: true }) === 'PUBLISHED').toBe(false);
        block.translations[1].title = 'Home';
        expect(contentPublicationStatus({ ...block, enabled: true }) === 'PUBLISHED').toBe(true);

        block.translations[1].title = '首页活动';
        expect(contentPublicationStatus({ ...block, enabled: true }) === 'PUBLISHED').toBe(false);
    });

    it('does not publish Chinese text stored in optional English fields', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const block = new StorefrontContentBlock({
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    title: '首页',
                    subtitle: '限时活动',
                    body: '',
                    ctaLabel: '',
                },
                {
                    languageCode: LanguageCode.en,
                    title: 'Home',
                    subtitle: '限时活动',
                    body: '',
                    ctaLabel: '',
                },
            ],
            items: [],
        });

        expect(contentPublicationStatus({ ...block, enabled: true }) === 'PUBLISHED').toBe(false);
    });

    it('uses the same image and translation publication reasons as the admin preview', () => {
        const block = {
            type: 'HERO',
            enabled: true,
            imageUrl: null as string | null,
            items: [],
            translations: [
                { languageCode: 'zh_Hans', title: '图片' },
                { languageCode: 'en', title: 'Image' },
            ],
        };
        expect(contentPublicationStatus(block)).toBe('MISSING_IMAGE');
        block.imageUrl = '/assets/preview/hero.webp';
        expect(contentPublicationStatus(block)).toBe('PUBLISHED');
        expect(contentPublicationStatus({ ...block, enabled: false })).toBe('DISABLED');
        expect(contentPublicationStatus({ ...block, startsAt: new Date(2000) }, 1000)).toBe('SCHEDULED');
        expect(contentPublicationStatus({ ...block, endsAt: new Date(1000) }, 1000)).toBe('EXPIRED');
        expect(contentPublicationStatus({ ...block, translations: [] })).toBe('INCOMPLETE_TRANSLATION');
        expect(contentPublicationStatus({ ...block, imageUrl: 'https://unmanaged.invalid/hero.jpg' })).toBe(
            'MISSING_IMAGE',
        );
    });

    it('requires an enabled hero to have a resolved image but allows an offline draft', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const missingImage = { asset: null, imageUrl: null };

        expect(() => (service as any).assertEnabledHeroHasImage('HERO', true, missingImage)).toThrow(
            /轮播图上线前必须/,
        );
        expect(() => (service as any).assertEnabledHeroHasImage('HERO', false, missingImage)).not.toThrow();
        expect(() =>
            (service as any).assertEnabledHeroHasImage('HERO', true, {
                asset: { id: 'asset-1' },
                imageUrl: '/assets/preview/hero.webp',
            }),
        ).not.toThrow();
    });

    it('omits a legacy enabled hero without an image from the Shop API result', async () => {
        const block = new StorefrontContentBlock({
            id: 'hero-without-image',
            type: 'HERO',
            enabled: true,
            imageUrl: null,
            startsAt: null,
            endsAt: null,
            translations: [
                { languageCode: LanguageCode.zh_Hans, title: '首页', subtitle: '', body: '', ctaLabel: '' },
                { languageCode: LanguageCode.en, title: 'Home', subtitle: '', body: '', ctaLabel: '' },
            ],
            items: [],
        });
        const repository = { find: vi.fn().mockResolvedValue([block]) };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const translator = { translate: vi.fn((value: StorefrontContentBlock) => value) };
        const service = new StorefrontContentService(
            connection as any,
            translator as any,
            { storefrontUrl: vi.fn() } as any,
            {} as any,
        );

        await expect(service.findPublished({ channelId: 'store-a' } as any)).resolves.toEqual([]);
    });
});

describe('StorefrontContentService sharing content isolation', () => {
    it('keeps sharing records available to admin but excludes them from published homepage content', async () => {
        const blocks = [undefined, 'referral-system-poster', 'referral-custom-poster'].map(
            (purpose, index) =>
                new StorefrontContentBlock({
                    id: `custom-${index}`,
                    type: 'CUSTOM',
                    enabled: true,
                    settings: purpose ? { purpose } : {},
                    startsAt: null,
                    endsAt: null,
                    translations: [
                        {
                            languageCode: LanguageCode.zh_Hans,
                            title: '分享海报',
                            subtitle: '',
                            body: '',
                            ctaLabel: '',
                        },
                        {
                            languageCode: LanguageCode.en,
                            title: 'Share poster',
                            subtitle: '',
                            body: '',
                            ctaLabel: '',
                        },
                    ],
                    items: [],
                }),
        );
        const repository = { find: vi.fn().mockResolvedValue(blocks) };
        const service = new StorefrontContentService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            { translate: vi.fn((value: StorefrontContentBlock) => value) } as any,
            { storefrontUrl: vi.fn() } as any,
            {} as any,
        );
        const ctx = { channelId: 'store-a' } as any;
        expect((await service.findPublished(ctx)).map(block => block.id)).toEqual(['custom-0']);
        expect((await service.findAllForAdmin(ctx)).map(block => block.id)).toEqual([
            'custom-0',
            'custom-1',
            'custom-2',
        ]);
    });
});

describe('StorefrontContentService image ownership', () => {
    it('imports an external URL and replaces it with the resulting Asset preview', async () => {
        const asset = { id: 'asset-1', preview: '/assets/preview/imported.png' };
        const connection = {
            getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }),
        };
        const externalImageService = {
            import: vi.fn().mockResolvedValue(asset),
            storefrontUrl: vi.fn().mockReturnValue('/assets/preview/imported.png'),
        };
        const service = new StorefrontContentService(
            connection as any,
            {} as any,
            externalImageService as any,
            {} as any,
        );

        await expect(
            (service as any).resolveImage(
                { channelId: 'default-channel' },
                null,
                'https://images.example.com/hero.png',
                '区块图片',
            ),
        ).resolves.toEqual({ asset, imageUrl: '/assets/preview/imported.png' });
        expect(externalImageService.import).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'default-channel' }),
            'https://images.example.com/hero.png',
        );
    });

    it('does not expose unmigrated third-party URLs through the Shop API', () => {
        const service = new StorefrontContentService({} as any, {} as any, {} as any, {} as any);

        expect((service as any).publishedLegacyImageUrl('/assets/preview/hero.png')).toBe(
            '/assets/preview/hero.png',
        );
        expect((service as any).publishedLegacyImageUrl('https://images.example.com/hero.png')).toBeNull();
    });
});

describe('StorefrontContentService Channel isolation', () => {
    it('lists and reads only content owned by the active Channel', async () => {
        const blocks = [
            new StorefrontContentBlock({
                id: 'block-a',
                channelId: 'store-a',
                code: 'hero',
                position: 0,
                items: [],
                translations: [],
            }),
            new StorefrontContentBlock({
                id: 'block-b',
                channelId: 'store-b',
                code: 'hero',
                position: 0,
                items: [],
                translations: [],
            }),
        ];
        const repository = {
            find: vi.fn(({ where }) =>
                Promise.resolve(blocks.filter(block => String(block.channelId) === String(where.channelId))),
            ),
            findOne: vi.fn(({ where }) =>
                Promise.resolve(
                    blocks.find(
                        block =>
                            String(block.id) === String(where.id) &&
                            String(block.channelId) === String(where.channelId),
                    ) ?? null,
                ),
            ),
        };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const translator = { translate: vi.fn(block => block) };
        const service = new StorefrontContentService(
            connection as any,
            translator as any,
            {} as any,
            {} as any,
        );

        await expect(service.findAllForAdmin({ channelId: 'store-a' } as any)).resolves.toEqual([
            expect.objectContaining({ id: 'block-a' }),
        ]);
        await expect(
            service.findOneForAdmin({ channelId: 'store-b' } as any, 'block-a'),
        ).resolves.toBeUndefined();
        expect(repository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'block-a', channelId: 'store-b', code: Not(STOREFRONT_VISUAL_PRESET_CODE) },
            }),
        );
    });
});

describe('StorefrontContentService carousel settings', () => {
    it('keeps configured types stable across query plans and settings saves without reordering floors', async () => {
        const floors = [
            { id: 'notice', type: 'NOTICE', position: 0 },
            { id: 'hero-b', type: 'HERO', position: 1 },
            { id: 'hero-a', type: 'HERO', position: 2 },
            { id: 'login', type: 'AUTH_LOGIN', position: 3 },
        ];
        const codeOrder = [floors[3], floors[2], floors[1], floors[0]];
        const blockRepository = { find: vi.fn() };
        const settings = new StorefrontContentSettings({
            channelId: 'store-a',
            heroAutoplayIntervalSeconds: 5,
        });
        const repository = {
            findOne: vi.fn().mockResolvedValue(settings),
            save: vi.fn((record: StorefrontContentSettings) => Promise.resolve(record)),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StorefrontContentBlock ? blockRepository : repository,
            ),
        };
        const service = new StorefrontContentService(
            connection as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const context = { channelId: 'store-a', channel: { id: 'store-a' } } as never;
        const expected = {
            heroAutoplayIntervalSeconds: 5,
            configuredBlockTypes: ['AUTH_LOGIN', 'HERO', 'NOTICE'],
        };

        for (const order of [floors, codeOrder]) {
            blockRepository.find.mockResolvedValue(order);
            await expect(service.getSettings(context)).resolves.toEqual(expected);
            await expect(
                service.updateSettings(context, { heroAutoplayIntervalSeconds: 5 }),
            ).resolves.toEqual(expected);
        }
        expect(floors.map(floor => floor.id)).toEqual(['notice', 'hero-b', 'hero-a', 'login']);
        expect(floors.map(floor => floor.position)).toEqual([0, 1, 2, 3]);
        expect(blockRepository.find).toHaveBeenCalledWith({
            where: { channelId: 'store-a', code: Not(STOREFRONT_VISUAL_PRESET_CODE) },
            select: { type: true },
        });
    });

    it('returns the five-second default without creating a settings record', async () => {
        const repository = { findOne: vi.fn(() => Promise.resolve(null)) };
        const blockRepository = { find: vi.fn(() => Promise.resolve([])) };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StorefrontContentBlock ? blockRepository : repository,
            ),
        };
        const service = new StorefrontContentService(connection as any, {} as any, {} as any, {} as any);

        await expect(service.getSettings({ channelId: 'store-a' } as any)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 5,
            configuredBlockTypes: [],
        });
        expect(repository.findOne).toHaveBeenCalledWith({ where: { channelId: 'store-a' } });
    });

    it('creates and updates settings only for the active Channel', async () => {
        const records: StorefrontContentSettings[] = [];
        const repository = {
            findOne: vi.fn(({ where }) =>
                Promise.resolve(records.find(item => String(item.channelId) === String(where.channelId))),
            ),
            save: vi.fn((settings: StorefrontContentSettings) => {
                if (!records.includes(settings)) records.push(settings);
                return Promise.resolve(settings);
            }),
        };
        const blockRepository = { find: vi.fn(() => Promise.resolve([])) };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StorefrontContentBlock ? blockRepository : repository,
            ),
        };
        const service = new StorefrontContentService(connection as any, {} as any, {} as any, {} as any);
        const context = { channelId: 'store-a', channel: { id: 'store-a' } } as any;

        await expect(service.updateSettings(context, { heroAutoplayIntervalSeconds: 9 })).resolves.toEqual({
            heroAutoplayIntervalSeconds: 9,
            configuredBlockTypes: [],
        });
        await expect(service.getSettings(context)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 9,
            configuredBlockTypes: [],
        });
        await expect(service.getSettings({ channelId: 'store-b' } as any)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 5,
            configuredBlockTypes: [],
        });
        expect(records).toEqual([
            expect.objectContaining({ channelId: 'store-a', heroAutoplayIntervalSeconds: 9 }),
        ]);
    });

    it('rejects non-integer or out-of-range intervals', async () => {
        const service = new StorefrontContentService({} as any, {} as any, {} as any, {} as any);
        const context = { channelId: 'store-a' } as any;

        await expect(service.updateSettings(context, { heroAutoplayIntervalSeconds: 2 })).rejects.toThrow(
            /3 到 30 秒/,
        );
        await expect(service.updateSettings(context, { heroAutoplayIntervalSeconds: 5.5 })).rejects.toThrow(
            /3 到 30 秒/,
        );
        await expect(service.updateSettings(context, { heroAutoplayIntervalSeconds: 31 })).rejects.toThrow(
            /3 到 30 秒/,
        );
    });
});

describe('StorefrontContentService optimistic concurrency', () => {
    const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);

    it('accepts the exact updatedAt version loaded by the editor', () => {
        const version = new Date('2026-08-27T10:00:00.000Z');

        expect(() => (service as any).assertExpectedUpdatedAt(version, version.toISOString())).not.toThrow();
    });

    it('rejects a stale or invalid editor version', () => {
        const current = new Date('2026-08-27T10:00:01.000Z');

        expect(() => (service as any).assertExpectedUpdatedAt(current, '2026-08-27T10:00:00.000Z')).toThrow(
            /CONCURRENT_MODIFICATION/,
        );
        expect(() => (service as any).assertExpectedUpdatedAt(current, 'invalid-date')).toThrow(
            /CONCURRENT_MODIFICATION/,
        );
    });

    it('locks the complete Channel block set before applying a composite change', async () => {
        const updatedAt = new Date('2026-08-27T10:00:00.000Z');
        const blocks = [
            new StorefrontContentBlock({ id: 'block-1', channelId: 'store-a', updatedAt }),
            new StorefrontContentBlock({ id: 'block-2', channelId: 'store-a', updatedAt }),
        ];
        const queryBuilder = {
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(blocks),
        };
        const repository = {
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
            find: vi.fn().mockResolvedValue(blocks),
        };
        const guardedService = new StorefrontContentService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(
            (guardedService as any).lockAndAssertBlockVersions(
                { channelId: 'store-a' },
                blocks.map(block => ({ id: block.id, expectedUpdatedAt: updatedAt.toISOString() })),
            ),
        ).resolves.toBeUndefined();
        expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(queryBuilder.orderBy).toHaveBeenCalledWith('block.id', 'ASC');
    });

    it('rejects a composite change when another administrator added or removed a block', async () => {
        const updatedAt = new Date('2026-08-27T10:00:00.000Z');
        const blocks = [new StorefrontContentBlock({ id: 'block-1', channelId: 'store-a', updatedAt })];
        const queryBuilder = {
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(blocks),
        };
        const repository = {
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
            find: vi.fn().mockResolvedValue(blocks),
        };
        const guardedService = new StorefrontContentService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(
            (guardedService as any).lockAndAssertBlockVersions({ channelId: 'store-a' }, []),
        ).rejects.toThrow(/CONCURRENT_MODIFICATION/);
    });
});

import 'reflect-metadata';

import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentSettings } from './entities/storefront-content-settings.entity';
import { StorefrontContentService } from './storefront-content.service';
import { CreateStorefrontContentBlockInput } from './types';

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
});

describe('StorefrontContentService publication guard', () => {
    it('requires matching Chinese and English customer-visible fields', () => {
        const service = new StorefrontContentService({} as never, {} as never, {} as never, {} as never);
        const block = new StorefrontContentBlock({
            translations: [
                { languageCode: LanguageCode.zh_Hans, title: '首页', subtitle: '', body: '', ctaLabel: '' },
                { languageCode: LanguageCode.en, title: '', subtitle: '', body: '', ctaLabel: '' },
            ],
            items: [],
        });

        expect((service as any).hasCompletePublishedTranslations(block)).toBe(false);
        block.translations[1].title = 'Home';
        expect((service as any).hasCompletePublishedTranslations(block)).toBe(true);
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
            expect.objectContaining({ where: { id: 'block-a', channelId: 'store-b' } }),
        );
    });
});

describe('StorefrontContentService carousel settings', () => {
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

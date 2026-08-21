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
    const service = new StorefrontContentService({} as never, {} as never);
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
            targetValue: '#/category',
            imageUrl: '/assets/hero.jpg',
            backgroundColor: '#ffffff',
        });
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
            find: vi.fn(async ({ where }) =>
                blocks.filter(block => String(block.channelId) === String(where.channelId)),
            ),
            findOne: vi.fn(
                async ({ where }) =>
                    blocks.find(
                        block =>
                            String(block.id) === String(where.id) &&
                            String(block.channelId) === String(where.channelId),
                    ) ?? null,
            ),
        };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const translator = { translate: vi.fn(block => block) };
        const service = new StorefrontContentService(connection as any, translator as any);

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
        const repository = { findOne: vi.fn(async () => null) };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const service = new StorefrontContentService(connection as any, {} as any);

        await expect(service.getSettings({ channelId: 'store-a' } as any)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 5,
        });
        expect(repository.findOne).toHaveBeenCalledWith({ where: { channelId: 'store-a' } });
    });

    it('creates and updates settings only for the active Channel', async () => {
        const records: StorefrontContentSettings[] = [];
        const repository = {
            findOne: vi.fn(async ({ where }) =>
                records.find(item => String(item.channelId) === String(where.channelId)),
            ),
            save: vi.fn(async (settings: StorefrontContentSettings) => {
                if (!records.includes(settings)) records.push(settings);
                return settings;
            }),
        };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const service = new StorefrontContentService(connection as any, {} as any);
        const context = { channelId: 'store-a', channel: { id: 'store-a' } } as any;

        await expect(service.updateSettings(context, { heroAutoplayIntervalSeconds: 9 })).resolves.toEqual({
            heroAutoplayIntervalSeconds: 9,
        });
        await expect(service.getSettings(context)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 9,
        });
        await expect(service.getSettings({ channelId: 'store-b' } as any)).resolves.toEqual({
            heroAutoplayIntervalSeconds: 5,
        });
        expect(records).toEqual([
            expect.objectContaining({ channelId: 'store-a', heroAutoplayIntervalSeconds: 9 }),
        ]);
    });

    it('rejects non-integer or out-of-range intervals', async () => {
        const service = new StorefrontContentService({} as any, {} as any);
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

import 'reflect-metadata';

import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

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

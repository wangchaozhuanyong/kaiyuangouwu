import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';

import { DefaultSlugStrategy } from './default-slug-strategy';

describe('DefaultSlugStrategy', () => {
    const strategy = new DefaultSlugStrategy();
    const ctx = {} as RequestContext;

    it.each([
        ['Hello World!', 'hello-world'],
        ['Café Français', 'cafe-francais'],
        ['100% Natural', '100-natural'],
        ['中文商品', '中文商品'],
        ['CRUD 巡检商品', 'crud-巡检商品'],
        ['商品 / Product -- 测试', '商品-product-测试'],
    ])('generates a URL slug for %s', (value, expected) => {
        expect(strategy.generate(ctx, { value })).toBe(expected);
    });

    it('returns an empty slug for an empty value', () => {
        expect(strategy.generate(ctx, { value: '' })).toBe('');
    });
});

import { describe, expect, it } from 'vitest';
import { ASSET_CATEGORIES, assetCategoryForAsset, assetTagsForCategory } from './asset-categories';

describe('asset category metadata', () => {
    it('provides the four shared filter choices', () => {
        expect(ASSET_CATEGORIES).toEqual([
            { value: 'ALL', label: '全部' },
            { value: 'PRODUCT', label: '商品图' },
            { value: 'QUICK_LINK', label: '金刚区' },
            { value: 'OTHER', label: '其他' },
        ]);
    });

    it.each([
        ['product-cover.webp', 'PRODUCT'],
        ['products/item.webp', 'PRODUCT'],
        ['商品详情-01.png', 'PRODUCT'],
        ['quick-link-01.png', 'QUICK_LINK'],
        ['quicklinks/entry.png', 'QUICK_LINK'],
        ['shortcuts-menu.png', 'QUICK_LINK'],
        ['首页金刚区.png', 'QUICK_LINK'],
        ['快捷入口.png', 'QUICK_LINK'],
        ['productivity-banner.png', 'OTHER'],
        ['quickly-banner.png', 'OTHER'],
        ['campaign.webp', 'OTHER'],
    ] as const)('classifies the legacy filename %s as %s', (name, category) => {
        expect(assetCategoryForAsset({ name })).toBe(category);
    });

    it('uses existing managed-key tags as a legacy fallback', () => {
        expect(
            assetCategoryForAsset({
                name: 'opaque.webp',
                tags: [{ value: 'managed:home/quicklinks/01' }],
            }),
        ).toBe('QUICK_LINK');
        expect(
            assetCategoryForAsset({
                name: 'opaque.webp',
                tags: [{ value: 'managed:product/item/cover' }],
            }),
        ).toBe('PRODUCT');
    });

    it('gives an explicit Other classification priority over product and quick-link names', () => {
        expect(
            assetCategoryForAsset({
                name: 'product-金刚区.webp',
                tags: [{ value: 'managed:product/cover' }, { value: ' 素材分类:其他 ' }],
            }),
        ).toBe('OTHER');
        expect(assetCategoryForAsset({ name: 'product-cover.webp', tags: [{ value: '其他' }] })).toBe(
            'OTHER',
        );
    });

    it('gives explicit classification priority over every legacy naming fallback', () => {
        expect(assetCategoryForAsset({ name: 'quicklinks.webp', tags: [{ value: '商品图' }] })).toBe(
            'PRODUCT',
        );
        expect(
            assetCategoryForAsset({ name: 'product-cover.webp', tags: [{ value: '素材分类:金刚区' }] }),
        ).toBe('QUICK_LINK');
    });

    it('changes only usage tags and preserves provenance, hashes and arbitrary merchant tags', () => {
        const original = [
            'managed:home/quicklinks/01',
            'sha256:synthetic-hash',
            'source:synthetic-upload',
            'summer-sale',
            '素材分类:商品图',
            '商品图',
            '素材分类:其他',
            'summer-sale',
            '',
        ];
        const changed = assetTagsForCategory(original, 'QUICK_LINK');
        expect(changed).toEqual([
            'managed:home/quicklinks/01',
            'sha256:synthetic-hash',
            'source:synthetic-upload',
            'summer-sale',
            '素材分类:金刚区',
        ]);
        expect(original).toContain('素材分类:商品图');
        expect(assetCategoryForAsset({ name: 'product.webp', tags: changed.map(value => ({ value })) })).toBe(
            'QUICK_LINK',
        );
        expect(assetTagsForCategory(changed, 'OTHER')).toEqual([
            'managed:home/quicklinks/01',
            'sha256:synthetic-hash',
            'source:synthetic-upload',
            'summer-sale',
            '素材分类:其他',
        ]);
    });
});

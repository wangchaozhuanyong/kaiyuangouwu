export type AssetCategory = 'ALL' | 'PRODUCT' | 'QUICK_LINK' | 'OTHER';
export type ImageAssetCategory = Exclude<AssetCategory, 'ALL'>;

export const ASSET_CATEGORIES = [
    { value: 'ALL', label: '全部' },
    { value: 'PRODUCT', label: '商品图' },
    { value: 'QUICK_LINK', label: '金刚区' },
    { value: 'OTHER', label: '其他' },
] as const;

const categoryTags: Record<ImageAssetCategory, string> = {
    PRODUCT: '素材分类:商品图',
    QUICK_LINK: '素材分类:金刚区',
    OTHER: '素材分类:其他',
};
const categoryForTag = new Map<string, ImageAssetCategory>(
    ASSET_CATEGORIES.filter(category => category.value !== 'ALL').flatMap(category => [
        [categoryTags[category.value as ImageAssetCategory], category.value as ImageAssetCategory],
        [category.label, category.value as ImageAssetCategory],
    ]),
);

/** Explicit merchant classification wins; legacy names/managed keys are only a fallback. */
export function assetCategoryForAsset(asset: {
    name: string;
    tags?: readonly { value: string }[];
}): ImageAssetCategory {
    const tags = asset.tags?.map(tag => tag.value.trim()) ?? [];
    for (const tag of tags) {
        const explicit = categoryForTag.get(tag);
        if (explicit) return explicit;
    }
    const names = [asset.name, ...tags].join(' ');
    if (/(?:^|[\s:/_.-])(?:quick|quicklinks?|shortcuts?)(?=$|[\s:/_.-])|金刚区|快捷入口/iu.test(names))
        return 'QUICK_LINK';
    if (/(?:^|[\s:/_.-])products?(?=$|[\s:/_.-])|商品(?:图|封面|详情)|产品图|详情图/iu.test(names))
        return 'PRODUCT';
    return 'OTHER';
}

/** Preserve provenance, hashes and arbitrary merchant tags when changing only classification. */
export function assetTagsForCategory(tags: readonly string[], category: ImageAssetCategory): string[] {
    return [
        ...new Set([
            ...tags.map(tag => tag.trim()).filter(tag => tag && !categoryForTag.has(tag)),
            categoryTags[category],
        ]),
    ];
}

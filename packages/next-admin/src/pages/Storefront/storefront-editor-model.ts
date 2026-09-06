import {
    type StorefrontAssetRef,
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontLanguageCode,
    type StorefrontTargetType,
} from '../../graphql/storefront.graphql';

export interface EditorOptionsResult {
    products: {
        items: Array<{
            id: string;
            name: string;
            slug: string;
            featuredAsset: { id: string; preview: string } | null;
        }>;
        totalItems: number;
    };
}

export interface AssetQueryResult {
    assets: { items: Array<StorefrontAssetRef & { type: string; mimeType: string }>; totalItems: number };
}

export interface CreateAssetResult extends Partial<StorefrontAssetRef> {
    __typename: 'Asset' | 'MimeTypeError';
    message?: string;
}

export interface CreateAssetsData {
    createAssets: CreateAssetResult[];
}

export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

export const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const targetOptions: Array<[StorefrontTargetType, string]> = [
    ['NONE', '无跳转'],
    ['URL', '网址'],
    ['PRODUCT', '商品 ID'],
    ['COLLECTION', '集合 ID'],
    ['CATEGORY', '分类'],
    ['SEARCH', '搜索关键词'],
    ['PAGE', '客户端页面'],
    ['SUPPORT', '客服中心'],
    ['COUPON', '优惠券'],
];

export function moveItem(items: StorefrontContentItem[], from: number, to: number) {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next.map((item, position) => ({ ...item, position }));
}

export function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function numberSetting(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function stringSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

export function localizedItemSettingKey(
    field: 'badgeLabel' | 'ctaLabel',
    language: StorefrontLanguageCode,
): string {
    return `${field}${language === 'zh_Hans' ? 'Zh' : 'En'}`;
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function moduleHasSettings(type: StorefrontContentBlock['type']) {
    return [
        'NOTICE',
        'CATEGORY_AD',
        'FEATURED_COLLECTION',
        'BEST_SELLERS',
        'RECOMMENDATIONS',
        'SUPPORT',
    ].includes(type);
}

export function moduleUsesItems(type: StorefrontContentBlock['type']) {
    return [
        'HERO',
        'AUTH_LOGIN',
        'AUTH_REGISTER',
        'NOTICE',
        'QUICK_LINKS',
        'CORE_CATEGORIES',
        'COUPONS',
        'TRUST_BAR',
        'LEGAL',
        'SUPPORT',
        'NAVIGATION',
        'CUSTOM',
    ].includes(type);
}

export const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

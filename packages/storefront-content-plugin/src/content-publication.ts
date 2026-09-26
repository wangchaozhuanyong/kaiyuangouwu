import { storefrontAssetUrl } from './content-image';
import { isSharingContent } from './content-purpose';

/** Content required before a customer can sign in; catalog blocks remain private. */
export const accountContentBlockTypes = ['LEGAL', 'SUPPORT', 'AUTH_LOGIN', 'AUTH_REGISTER'] as const;

export function isAccountContentBlockType(type: string): boolean {
    return accountContentBlockTypes.some(accountType => accountType === type);
}

interface Translation {
    languageCode: string;
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    label?: string;
    description?: string;
}

interface PublicationBlock {
    type: string;
    enabled: boolean;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    imageUrl?: string | null;
    imageAsset?: { preview?: string; source?: string; mimeType?: string } | null;
    settings?: unknown;
    translations?: Translation[];
    items?: Array<{ enabled: boolean; position?: number; translations?: Translation[] }>;
}

/** Match the client order and limit without changing the saved Admin draft. */
export function publishedContentItems<T extends { enabled: boolean; position?: number }>(block: {
    type: string;
    items?: T[];
}): T[] {
    const enabled = (block.items ?? []).filter(item => item.enabled);
    if (block.type !== 'CORE_CATEGORIES') return enabled;
    return enabled.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, 2);
}

export type ContentPublicationStatus =
    | 'PUBLISHED'
    | 'DISABLED'
    | 'SCHEDULED'
    | 'EXPIRED'
    | 'INCOMPLETE_TRANSLATION'
    | 'MISSING_IMAGE'
    | 'MISSING_ITEMS'
    | 'SHARING';

export const contentPublicationLabels: Record<ContentPublicationStatus, string> = {
    PUBLISHED: '已发布',
    DISABLED: '已停用',
    SCHEDULED: '未到展示时间',
    EXPIRED: '已过期',
    INCOMPLETE_TRANSLATION: '中英文内容未完成',
    MISSING_IMAGE: '缺少已发布图片',
    MISSING_ITEMS: '缺少已启用卡片',
    SHARING: '分享设置专用',
};

/** Shared by the Admin preview and Shop API; disabled items do not block publication. */
export function createContentPublicationChecker(isUsableEnglishTranslation: (value: unknown) => boolean) {
    function translationPair(source = '', target = '') {
        return source.trim() ? isUsableEnglishTranslation(target) : !target.trim();
    }
    return function contentPublicationStatus(
        block: PublicationBlock,
        now = Date.now(),
        languageCode = 'en',
    ): ContentPublicationStatus {
        if (isSharingContent(block)) return 'SHARING';
        if (!block.enabled) return 'DISABLED';
        if (block.startsAt && new Date(block.startsAt).getTime() > now) return 'SCHEDULED';
        if (block.endsAt && new Date(block.endsAt).getTime() <= now) return 'EXPIRED';
        const requireEnglish = !languageCode.toLowerCase().startsWith('zh');
        const isAuth = block.type === 'AUTH_LOGIN' || block.type === 'AUTH_REGISTER';
        const source = block.translations?.find(t => t.languageCode === 'zh_Hans');
        const target = block.translations?.find(t => t.languageCode === 'en');
        const items = publishedContentItems(block);
        if (
            (isAuth ? !source : !source?.title?.trim()) ||
            (requireEnglish &&
                (isAuth
                    ? !target || !translationPair(source?.title, target.title)
                    : !isUsableEnglishTranslation(target?.title))) ||
            (requireEnglish &&
                (['subtitle', 'body', 'ctaLabel'] as const).some(
                    field => !translationPair(source?.[field], target?.[field]),
                )) ||
            items.some(item => {
                const zh = item.translations?.find(t => t.languageCode === 'zh_Hans');
                const en = item.translations?.find(t => t.languageCode === 'en');
                return (
                    (isAuth ? !zh : !zh?.label?.trim()) ||
                    (requireEnglish &&
                        (isAuth
                            ? !en || !translationPair(zh?.label, en.label)
                            : !isUsableEnglishTranslation(en?.label))) ||
                    (requireEnglish && !translationPair(zh?.description, en?.description))
                );
            })
        )
            return 'INCOMPLETE_TRANSLATION';
        const image = block.imageAsset
            ? storefrontAssetUrl(block.imageAsset)
            : block.imageUrl?.trim().startsWith('/assets/')
              ? block.imageUrl.trim()
              : null;
        if (block.type === 'HERO' && !image) return 'MISSING_IMAGE';
        if (block.type === 'CORE_CATEGORIES' && !items.length) {
            return 'MISSING_ITEMS';
        }
        return 'PUBLISHED';
    };
}

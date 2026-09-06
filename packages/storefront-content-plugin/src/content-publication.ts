import { storefrontAssetUrl } from './content-image';
import { isSharingContent } from './content-purpose';

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
    items?: Array<{ enabled: boolean; translations?: Translation[] }>;
}

export type ContentPublicationStatus =
    | 'PUBLISHED'
    | 'DISABLED'
    | 'SCHEDULED'
    | 'EXPIRED'
    | 'INCOMPLETE_TRANSLATION'
    | 'MISSING_IMAGE'
    | 'SHARING';

export const contentPublicationLabels: Record<ContentPublicationStatus, string> = {
    PUBLISHED: '展示中',
    DISABLED: '已停用',
    SCHEDULED: '未到展示时间',
    EXPIRED: '已过期',
    INCOMPLETE_TRANSLATION: '中英文内容未完成',
    MISSING_IMAGE: '缺少已发布图片',
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
    ): ContentPublicationStatus {
        if (isSharingContent(block)) return 'SHARING';
        if (!block.enabled) return 'DISABLED';
        if (block.startsAt && new Date(block.startsAt).getTime() > now) return 'SCHEDULED';
        if (block.endsAt && new Date(block.endsAt).getTime() <= now) return 'EXPIRED';
        const isAuth = block.type === 'AUTH_LOGIN' || block.type === 'AUTH_REGISTER';
        const source = block.translations?.find(t => t.languageCode === 'zh_Hans');
        const target = block.translations?.find(t => t.languageCode === 'en');
        if (
            (isAuth
                ? !source || !target || !translationPair(source.title, target.title)
                : !source?.title?.trim() || !isUsableEnglishTranslation(target?.title)) ||
            (['subtitle', 'body', 'ctaLabel'] as const).some(
                field => !translationPair(source?.[field], target?.[field]),
            ) ||
            (block.items ?? [])
                .filter(item => item.enabled)
                .some(item => {
                    const zh = item.translations?.find(t => t.languageCode === 'zh_Hans');
                    const en = item.translations?.find(t => t.languageCode === 'en');
                    return (
                        (isAuth
                            ? !zh || !en || !translationPair(zh.label, en.label)
                            : !zh?.label?.trim() || !isUsableEnglishTranslation(en?.label)) ||
                        !translationPair(zh?.description, en?.description)
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
        return 'PUBLISHED';
    };
}

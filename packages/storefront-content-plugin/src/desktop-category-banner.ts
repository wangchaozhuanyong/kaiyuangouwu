export const DESKTOP_CATEGORY_BANNER_PURPOSE = 'desktop-category-banner';
export const DESKTOP_CATEGORY_BANNER_PREFIX = 'desktop-category-banner-';
export const DESKTOP_CATEGORY_BANNER_DEFAULT = 'default';

export type DesktopCategoryBannerMode = 'image' | 'text';
export type DesktopCategoryBannerLayout = 'side' | 'background';
export type DesktopCategoryBannerFocal = 'left' | 'center' | 'right';

export interface DesktopCategoryBannerSettings {
    purpose: typeof DESKTOP_CATEGORY_BANNER_PURPOSE;
    categoryId: string;
    mode: DesktopCategoryBannerMode;
    layout: DesktopCategoryBannerLayout;
    focal: DesktopCategoryBannerFocal;
}

export function desktopCategoryBannerCode(categoryId: string): string {
    return `${DESKTOP_CATEGORY_BANNER_PREFIX}${categoryId}`;
}

/** Both Admin interfaces save the same published desktop-only content contract. */
export function desktopCategoryBannerInput(
    categoryId: string,
    draft: {
        mode: DesktopCategoryBannerMode;
        layout: DesktopCategoryBannerLayout;
        focal: DesktopCategoryBannerFocal;
        imageAssetId: string | null;
        imageUrl: string | null;
    },
) {
    return {
        code: desktopCategoryBannerCode(categoryId),
        internalName:
            categoryId === DESKTOP_CATEGORY_BANNER_DEFAULT
                ? '分类默认页首横幅'
                : `分类 ${categoryId} 页首横幅`,
        type: 'CUSTOM' as const,
        layoutVariant: 'CUSTOM' as const,
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageAssetId: draft.mode === 'image' ? draft.imageAssetId : null,
        imageUrl: draft.mode === 'image' && !draft.imageAssetId ? draft.imageUrl : null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE' as const,
        targetValue: null,
        settings: {
            purpose: DESKTOP_CATEGORY_BANNER_PURPOSE,
            categoryId,
            mode: draft.mode,
            layout: draft.layout,
            focal: draft.focal,
        },
        translations: [
            {
                languageCode: 'zh_Hans' as const,
                title: '电脑端分类横幅',
                subtitle: '',
                body: '',
                ctaLabel: '',
            },
            {
                languageCode: 'en' as const,
                title: 'Desktop category banner',
                subtitle: '',
                body: '',
                ctaLabel: '',
            },
        ],
        items: [],
    };
}

export function parseDesktopCategoryBannerSettings(block: {
    type: string;
    code: string;
    settings?: unknown;
}): DesktopCategoryBannerSettings | null {
    const settings = block.settings;
    if (block.type !== 'CUSTOM' || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return null;
    }
    const record = settings as Record<string, unknown>;
    const categoryId = record.categoryId;
    if (
        record.purpose !== DESKTOP_CATEGORY_BANNER_PURPOSE ||
        typeof categoryId !== 'string' ||
        !categoryId ||
        block.code !== desktopCategoryBannerCode(categoryId) ||
        (record.mode !== 'image' && record.mode !== 'text') ||
        (record.layout !== 'side' && record.layout !== 'background') ||
        (record.focal !== 'left' && record.focal !== 'center' && record.focal !== 'right')
    ) {
        return null;
    }
    return record as unknown as DesktopCategoryBannerSettings;
}

export function resolveDesktopCategoryBanner<
    T extends {
        type: string;
        code: string;
        settings?: unknown;
    },
>(
    blocks: T[],
    categoryId?: string | null,
    parentCategoryId?: string | null,
): { block: T; settings: DesktopCategoryBannerSettings } | null {
    const byCategory = new Map<string, { block: T; settings: DesktopCategoryBannerSettings }>();
    for (const block of blocks) {
        const settings = parseDesktopCategoryBannerSettings(block);
        if (settings) byCategory.set(settings.categoryId, { block, settings });
    }
    for (const id of [categoryId, parentCategoryId, DESKTOP_CATEGORY_BANNER_DEFAULT]) {
        if (!id) continue;
        const match = byCategory.get(id);
        if (match) return match;
    }
    return null;
}

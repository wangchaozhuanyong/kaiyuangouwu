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

// Retained only to validate historical records; the category banner UI is retired.
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

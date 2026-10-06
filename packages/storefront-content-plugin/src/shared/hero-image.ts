export const mobileHeroTextFields = ['title', 'subtitle', 'body', 'ctaLabel'] as const;

export interface MobileHeroTranslation {
    languageCode: 'zh_Hans' | 'en';
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
}

export interface HeroImageContent {
    imageUrl?: string | null;
    imageAsset?: { width?: number; height?: number } | null;
    settings?: Record<string, unknown> | null;
}

export interface HeroPresentationContent extends HeroImageContent {
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    textColor?: string | null;
    items?: readonly unknown[];
}

export interface HeroViewportImage {
    imageUrl: string;
    imageAsset?: { width?: number; height?: number };
}

function imageDimension(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Viewport selection is shared by the real storefront, preload and Admin's client iframe. */
export function heroImageForViewport(
    content: HeroImageContent | undefined,
    desktop: boolean,
): HeroViewportImage {
    const mobileImageUrl = content?.settings?.mobileImageUrl;
    if (!desktop && typeof mobileImageUrl === 'string' && mobileImageUrl.trim()) {
        const width = imageDimension(content?.settings?.mobileImageWidth);
        const height = imageDimension(content?.settings?.mobileImageHeight);
        return {
            imageUrl: mobileImageUrl.trim(),
            ...(width || height ? { imageAsset: { width, height } } : {}),
        };
    }
    return {
        imageUrl: content?.imageUrl?.trim() ?? '',
        ...(content?.imageAsset ? { imageAsset: content.imageAsset } : {}),
    };
}

export function mobileHeroTranslation(
    settings: Record<string, unknown> | null | undefined,
    languageCode: 'zh_Hans' | 'en',
): MobileHeroTranslation {
    const translations = settings?.mobileHeroTranslations;
    const translation = Array.isArray(translations)
        ? translations.find(
              value => value && typeof value === 'object' && value.languageCode === languageCode,
          )
        : undefined;
    return {
        languageCode,
        ...Object.fromEntries(
            mobileHeroTextFields.flatMap(field =>
                typeof translation?.[field] === 'string' ? [[field, translation[field]]] : [],
            ),
        ),
    };
}

/** Unset phone copy inherits the translated desktop copy; explicit empty copy stays hidden. */
export function heroContentForViewport<T extends HeroPresentationContent>(
    content: T,
    desktop: boolean,
    language: 'zh' | 'en',
): T {
    if (desktop) return content;
    const copy = mobileHeroTranslation(content.settings, language === 'zh' ? 'zh_Hans' : 'en');
    const settings = content.settings ?? {};
    const textColor = settings.mobileHeroTextColor;
    const secondaryTextColor = settings.mobileHeroSecondaryTextColor;
    const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
    const image = heroImageForViewport(content, false);
    return {
        ...content,
        imageUrl: image.imageUrl,
        imageAsset: image.imageAsset ?? null,
        ...Object.fromEntries(
            mobileHeroTextFields.flatMap(field => {
                const value = copy[field];
                return typeof value === 'string' ? [[field, value.trim()]] : [];
            }),
        ),
        ...(color(textColor) ? { textColor: (textColor as string).trim() } : {}),
        ...(settings.mobileHeroHideStats === true ? { items: [] } : {}),
        ...(color(secondaryTextColor)
            ? { settings: { ...settings, secondaryTextColor: (secondaryTextColor as string).trim() } }
            : {}),
    };
}

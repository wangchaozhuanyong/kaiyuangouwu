import { type CSSProperties, type ReactNode, useState } from 'react';

import { authOriginalImageUrl, configuredColor } from './auth-visual-utils';
import { ContentText } from './content-text';
import { type ImageTone, useImageTone } from './image-tone';
import { readableStorefrontForeground, storefrontContrastRatio } from './storefront-semantic-palette';

export { authOriginalImageUrl, configuredColor } from './auth-visual-utils';

export interface AuthVisualData {
    imageUrl?: string | null;
    title: string;
    subtitle: string;
    ctaLabel: string;
    backgroundColor?: string | null;
    textColor?: string | null;
    settings?: Record<string, unknown> | null;
    items: Array<{ id?: string; label: string; enabled?: boolean }>;
}

/** Shared editor/runtime contract; absent fields keep a neutral, usable account page. */
export const authBenefitIcons = [
    'shopping-bag',
    'map-pin',
    'store',
    'compass',
    'shield-check',
    'headphones',
    'sparkles',
] as const;
export type AuthBenefitIcon = (typeof authBenefitIcons)[number];

export function authPresentation(
    content: Pick<AuthVisualData, 'settings'> | undefined,
    variant: 'login' | 'register',
    language: string,
) {
    const settings = content?.settings;
    const zh = language === 'zh' || language === 'zh_Hans';
    const copy = (key: string, fallback: string) => {
        const value = settings?.[`${key}${zh ? 'Zh' : 'En'}`];
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    };
    const decoration = settings?.mobileDecorationImageUrl;
    return {
        title: copy(
            'formTitle',
            variant === 'login' ? (zh ? '登录账户' : 'Sign in') : zh ? '注册账户' : 'Create account',
        ),
        subtitle: copy(
            'formSubtitle',
            variant === 'login'
                ? zh
                    ? '连接本地服务'
                    : 'Connect with local services'
                : zh
                  ? '开启购物之旅'
                  : 'Start your shopping journey',
        ),
        position: settings?.heroCopyPosition === 'bottom' ? 'bottom' : 'center',
        benefitsStyle: settings?.heroBenefitsStyle === 'tags' ? 'tags' : 'icons',
        showLogo: settings?.heroLogoEnabled !== false,
        // Managed decoration is optional and never supplied from a store-name fallback.
        decorationUrl:
            typeof decoration === 'string' && /^(https?:\/\/|\/(?!\/))/.test(decoration)
                ? decoration
                : undefined,
    };
}

export function readableColor(background: string): string {
    const rgb = [1, 3, 5].map(offset => {
        const component = parseInt(background.slice(offset, offset + 2), 16) / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#172033' : '#ffffff';
}

/** Explicit block colors inherit from the store; image loading never changes the copy surface. */
export function authVisualStyle(content?: AuthVisualData, imageTone?: ImageTone): CSSProperties {
    const background = configuredColor(content?.backgroundColor);
    const accent = configuredColor(content?.settings?.accentColor);
    const configuredText = configuredColor(content?.textColor);
    const hasImage = Boolean(content?.imageUrl?.trim());
    const isLightTone =
        imageTone === 'light' || (background ? readableColor(background) === '#172033' : false);

    // A managed image never controls the copy palette: its tone may arrive after
    // first paint, while the store surface stays stable through image loading.
    const copySurface = background;
    const foreground = copySurface
        ? configuredText && storefrontContrastRatio(configuredText, copySurface) >= 4.5
            ? configuredText
            : readableStorefrontForeground(copySurface)
        : hasImage
          ? 'var(--text, var(--auth-store-foreground, #0f172a))'
          : (configuredText ?? 'var(--auth-store-foreground, var(--store-foreground, #0f172a))');
    const secondaryColor = copySurface || hasImage ? foreground : 'var(--muted, #475569)';

    return {
        '--auth-visual-background':
            copySurface ??
            (hasImage
                ? 'var(--surface, var(--auth-store-background, #f1f5f9))'
                : 'var(--auth-store-background, var(--skin-background, #f1f5f9))'),
        '--auth-visual-foreground': foreground,
        '--auth-hero-secondary-text': secondaryColor,
        '--auth-visual-accent': accent ?? (isLightTone ? '#2563eb' : 'var(--accent, #635bff)'),
    } as CSSProperties;
}

function AuthVisualImage({ source, language }: { source: string; language: string }) {
    const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
    return (
        <div
            className="store-auth-image"
            style={{ position: 'relative', width: '100%', minHeight: status === 'loaded' ? undefined : 120 }}
        >
            {status !== 'loaded' && (
                <div role="status" style={{ padding: 32, textAlign: 'center', opacity: 0.75 }}>
                    {language === 'zh'
                        ? status === 'failed'
                            ? '图片暂不可用'
                            : '图片加载中'
                        : status === 'failed'
                          ? 'Image unavailable'
                          : 'Loading image'}
                </div>
            )}
            {status !== 'failed' && (
                <img
                    src={source}
                    alt=""
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    onLoad={() => setStatus('loaded')}
                    onError={() => setStatus('failed')}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: 'auto',
                        objectFit: 'contain',
                        filter: 'none',
                        opacity: status === 'loaded' ? 1 : 0,
                    }}
                />
            )}
        </div>
    );
}

/** The storefront and administrator preview render this same managed content. */
export function AuthVisual({
    content,
    language,
    header,
}: {
    content: AuthVisualData;
    language: string;
    header?: ReactNode;
}) {
    const source = authOriginalImageUrl(content.imageUrl ?? '');
    const imageTone = useImageTone(source);
    const items = content.items.filter(item => item.enabled !== false && item.label.trim());
    return (
        <section
            className="store-auth-visual"
            data-image-tone={imageTone}
            style={{
                ...authVisualStyle(content, imageTone),
                minWidth: 0,
                background: 'var(--auth-visual-background)',
                color: 'var(--auth-visual-foreground)',
                overflow: 'hidden',
            }}
        >
            {header}
            {source && <AuthVisualImage key={source} source={source} language={language} />}
            <div
                className="store-auth-copy"
                style={{
                    display: 'grid',
                    gap: 16,
                    padding: 'clamp(20px, 3vw, 36px)',
                    overflowWrap: 'anywhere',
                }}
            >
                {content.ctaLabel && (
                    <span
                        style={{
                            fontSize: 'var(--type-helper-size)',
                            lineHeight: 'var(--type-helper-leading)',
                            fontWeight: 'var(--font-weight-semibold)',
                        }}
                    >
                        {content.ctaLabel}
                    </span>
                )}
                {content.title && (
                    <h2
                        style={{
                            margin: 0,
                            color: 'inherit',
                            fontSize: 'var(--type-hero-size)',
                            lineHeight: 'var(--type-hero-leading)',
                        }}
                    >
                        {content.title}
                    </h2>
                )}
                {content.subtitle && (
                    <ContentText
                        style={{
                            margin: 0,
                            color: 'inherit',
                            fontSize: 'var(--type-reading-size)',
                            lineHeight: 'var(--type-reading-leading)',
                        }}
                    >
                        {content.subtitle}
                    </ContentText>
                )}
                {items.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {items.map((item, index) => (
                            <span
                                key={item.id ?? index}
                                style={{
                                    border: '1px solid currentColor',
                                    borderRadius: 8,
                                    padding: '6px 10px',
                                    fontSize: 'var(--type-helper-size)',
                                    lineHeight: 'var(--type-helper-leading)',
                                }}
                            >
                                {item.label}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

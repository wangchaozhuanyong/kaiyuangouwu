import { type CSSProperties, type ReactNode, useState } from 'react';

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

export function configuredColor(value: unknown): string | undefined {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : undefined;
}

export function readableColor(background: string): string {
    const rgb = [1, 3, 5].map(offset => {
        const component = parseInt(background.slice(offset, offset + 2), 16) / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#172033' : '#ffffff';
}

/** Explicit block colors inherit from the current store when left unset. */
export function authVisualStyle(content?: AuthVisualData): CSSProperties {
    const background = configuredColor(content?.backgroundColor);
    const accent = configuredColor(content?.settings?.accentColor);
    return {
        '--auth-visual-background':
            background ?? 'var(--auth-store-background, var(--skin-background, #f1f5f9))',
        '--auth-visual-foreground':
            configuredColor(content?.textColor) ??
            (background
                ? readableColor(background)
                : 'var(--auth-store-foreground, var(--skin-foreground, #172033))'),
        '--auth-accent': accent ?? 'var(--accent, #635bff)',
        '--auth-button-foreground': accent ? readableColor(accent) : 'var(--accent-foreground, #ffffff)',
    } as CSSProperties;
}

/** Use the existing non-cropping asset preset; external URLs remain unchanged. */
export function authOriginalImageUrl(value: string): string {
    const source = value.trim();
    if (!source) return '';
    try {
        const url = new URL(source, 'https://storefront.invalid');
        if (!/\/assets\/(?:preview|source)\//.test(url.pathname) || /\.svg$/i.test(url.pathname))
            return source;
        for (const key of ['w', 'h', 'width', 'height', 'mode', 'fit', 'crop']) url.searchParams.delete(key);
        url.searchParams.set('preset', 'storefront-original-preview');
        url.searchParams.set('format', 'webp');
        url.searchParams.set('q', '90');
        return /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return '';
    }
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
    const items = content.items.filter(item => item.enabled !== false && item.label.trim());
    return (
        <section
            className="store-auth-visual"
            style={{
                ...authVisualStyle(content),
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
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{content.ctaLabel}</span>
                )}
                {content.title && (
                    <h2
                        style={{
                            margin: 0,
                            color: 'inherit',
                            fontSize: 'clamp(24px, 3vw, 36px)',
                            lineHeight: 1.3,
                        }}
                    >
                        {content.title}
                    </h2>
                )}
                {content.subtitle && (
                    <p style={{ margin: 0, color: 'inherit', fontSize: 15, lineHeight: 1.7 }}>
                        {content.subtitle}
                    </p>
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
                                    fontSize: 13,
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

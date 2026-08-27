import {
    Cpu,
    Download,
    Globe,
    LayoutGrid,
    Package,
    ShieldCheck,
    ShoppingBag,
    Smartphone,
    Sparkles,
    TicketPercent,
    Zap,
} from 'lucide-react';
import { ImgHTMLAttributes, ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { responsiveImageSources, StorefrontImageKind, storefrontPlaceholderUrl } from '../responsive-image';
import { CollectionSummary, OrderSummary, Product, ProductVariant } from '../types';

export function OpenAiIcon({ className }: { className?: string }) {
    const pathD = [
        'M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.5-2.9 6.07 6.07 0 0 0-10.28 2.17',
        ' 5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0',
        ' 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm',
        '-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02',
        ' 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.14.08',
        ' 4.79 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34',
        ' 7.9a4.48 4.48 0 0 1 2.37-1.98V11.6a.77.77 0 0 0 .38.68l5.82 3.35-2.02 1.17a.08.08 0 0 1-.07',
        ' 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.85L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07',
        ' 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79',
        ' 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0',
        ' 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.79 2.76a.79.79 0 0 0-.39.68zm1.1-2.36l2.6-1.5',
        ' 2.6 1.5v3l-2.6 1.5-2.6-1.5z',
    ].join('');

    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d={pathD} />
        </svg>
    );
}

export function ClaudeIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 100 100" fill="currentColor" className={className} aria-hidden="true">
            <polygon points="43.5,14 56.5,14 62.5,41.5 89,33.5 93,46 68.5,58 87.5,79 77.5,88 56.5,69 49,95 36.5,92 43.5,65 17,76 12,64 35,49.5 14,31 22.5,21 44.5,38" />
        </svg>
    );
}

export function MidjourneyIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M3 19c3-1 6-1 9 0 3-1 6-1 9 0" />
            <path d="M4 15c2.5-.8 5-.8 7.5 0 2.5-.8 5-.8 7.5 0" />
            <path d="M12 3v13" />
            <path d="M12 3c-3 3-5 7-5 10" />
            <path d="M12 3c3 3 5 7 5 10" />
        </svg>
    );
}

export function CursorIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M4 3l15 9-7 2-4 7-4-18z" />
        </svg>
    );
}

export function DeepSeekIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7a5 5 0 0 1 5 5c0 2.5-1.8 4.2-5 5" />
            <path d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5" />
        </svg>
    );
}

export function GeminiIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M12 2C12 7.5 7.5 12 2 12C7.5 12 12 16.5 12 22C12 16.5 16.5 12 22 12C16.5 12 12 7.5 12 2Z" />
        </svg>
    );
}

export function parseAiProductInfo(name: string, description?: string) {
    const raw = `${name} ${description ?? ''}`.toLowerCase();

    let brand: 'chatgpt' | 'claude' | 'midjourney' | 'cursor' | 'deepseek' | 'gemini' | 'generic' = 'generic';
    let brandName = 'AI 助手';
    let companyName = 'DIGITAL';
    let brandTheme = 'is-chatgpt';

    if (
        raw.includes('chatgpt') ||
        raw.includes('openai') ||
        raw.includes('gpt-4') ||
        raw.includes('gpt4') ||
        raw.includes('gpt-o') ||
        raw.includes('gpt') ||
        raw.includes('sora')
    ) {
        brand = 'chatgpt';
        brandName = 'ChatGPT';
        companyName = 'OPENAI';
        brandTheme = 'is-chatgpt';
    } else if (
        raw.includes('claude') ||
        raw.includes('anthropic') ||
        raw.includes('sonnet') ||
        raw.includes('opus')
    ) {
        brand = 'claude';
        brandName = 'Claude';
        companyName = 'ANTHROPIC';
        brandTheme = 'is-claude';
    } else if (raw.includes('midjourney') || raw.includes('mj')) {
        brand = 'midjourney';
        brandName = 'Midjourney';
        companyName = 'MIDJOURNEY';
        brandTheme = 'is-midjourney';
    } else if (raw.includes('cursor') || raw.includes('copilot')) {
        brand = 'cursor';
        brandName = 'Cursor';
        companyName = 'CURSOR AI';
        brandTheme = 'is-cursor';
    } else if (raw.includes('deepseek') || raw.includes('深度求索')) {
        brand = 'deepseek';
        brandName = 'DeepSeek';
        companyName = 'DEEPSEEK';
        brandTheme = 'is-deepseek';
    } else if (raw.includes('gemini') || raw.includes('google ai') || raw.includes('bard')) {
        brand = 'gemini';
        brandName = 'Gemini';
        companyName = 'GOOGLE AI';
        brandTheme = 'is-gemini';
    }

    let tier = '';
    const has20x = /20x|20倍|20\s*x/i.test(name);
    const has10x = /10x|10倍|10\s*x/i.test(name);
    const has5x = /5x|5倍|5\s*x/i.test(name);
    const hasPlus = /plus|普拉斯/i.test(name);
    const hasPro = /pro|专业版/i.test(name);
    const hasTeam = /team|团队/i.test(name);
    const has4o = /4o|gpt-4o/i.test(name);
    const hasO1 = /o1|o3/i.test(name);
    const hasSonnet = /sonnet|3\.5/i.test(name);
    const hasR1 = /r1/i.test(name);
    const hasV3 = /v3/i.test(name);

    if (hasPro && has20x) tier = 'PRO 20x';
    else if (hasPlus && has20x) tier = 'PLUS 20x';
    else if (hasPro && has10x) tier = 'PRO 10x';
    else if (hasPlus && has10x) tier = 'PLUS 10x';
    else if (has20x) tier = '20x';
    else if (has10x) tier = '10x';
    else if (has5x) tier = '5x';
    else if (hasPlus) tier = 'PLUS';
    else if (hasPro) tier = 'PRO';
    else if (hasTeam) tier = 'TEAM';
    else if (has4o) tier = 'GPT-4o';
    else if (hasO1) tier = 'o1 / o3';
    else if (hasSonnet) tier = 'SONNET 3.5';
    else if (hasR1) tier = 'R1';
    else if (hasV3) tier = 'V3';
    else if (/api/i.test(name)) tier = 'API';
    else if (/独享/i.test(name)) tier = '独享';
    else tier = '数字商品';

    return { brand, brandName, companyName, brandTheme, tier };
}

export function AiProductCover({
    name,
    description,
    compact = false,
}: {
    name: string;
    description?: string;
    compact?: boolean;
}) {
    const { brand, brandName, companyName, brandTheme, tier } = parseAiProductInfo(name, description);

    return (
        <div className={`ai-product-cover ${brandTheme} ${compact ? 'is-compact' : ''}`} aria-hidden="true">
            <div className="ai-cover-grid-bg" />
            <div className="ai-cover-glow" />
            <div className="ai-cover-header-meta">
                <span className="ai-cover-company">⚡ {companyName}</span>
                <span className="ai-cover-status">商品</span>
            </div>
            <div className="ai-cover-logo-hero">
                <div className="ai-cover-logo-prism">
                    {brand === 'chatgpt' && <OpenAiIcon className="ai-hero-brand-svg" />}
                    {brand === 'claude' && <ClaudeIcon className="ai-hero-brand-svg" />}
                    {brand === 'midjourney' && <MidjourneyIcon className="ai-hero-brand-svg" />}
                    {brand === 'cursor' && <CursorIcon className="ai-hero-brand-svg" />}
                    {brand === 'deepseek' && <DeepSeekIcon className="ai-hero-brand-svg" />}
                    {brand === 'gemini' && <GeminiIcon className="ai-hero-brand-svg" />}
                    {brand === 'generic' && <Sparkles className="ai-hero-brand-svg" />}
                </div>
                <span className="ai-cover-brand-title">{brandName}</span>
            </div>
            <div className="ai-cover-footer-meta">
                <span className="ai-cover-tier-badge">{tier}</span>
            </div>
        </div>
    );
}

export function ProductImage({ product }: { product: Product }) {
    const image = productImage(product);

    if (!image || image.includes('placeholder') || image.includes('default-hero')) {
        const { brand } = parseAiProductInfo(product.name, product.description);
        return brand === 'generic' ? (
            <div className="image-placeholder" aria-hidden="true">
                <Package />
            </div>
        ) : (
            <AiProductCover name={product.name} description={product.description} />
        );
    }

    return <SafeImage src={image} alt={product.name} imageKind="card" loading="lazy" />;
}

export function shouldPrefetchMedia(): boolean {
    const connection = (
        navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
        }
    ).connection;
    return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

export function scheduleIdleWork(work: () => void): void {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(work, { timeout: 1_500 });
    } else {
        setTimeout(work, 120);
    }
}

export function prefetchStorefrontImage(src: string, imageKind: StorefrontImageKind): void {
    if (!shouldPrefetchMedia()) return;
    void decodeStorefrontImage(src, imageKind).catch(() => undefined);
}

export async function decodeStorefrontImage(src: string, imageKind: StorefrontImageKind): Promise<void> {
    const responsiveSource = responsiveImageSources(src, imageKind);
    const image = new Image();
    if (responsiveSource) {
        image.srcset = responsiveSource.webpSrcSet;
        image.sizes = responsiveSource.sizes;
        image.src = responsiveSource.fallbackSrc;
    } else {
        image.src = src;
    }
    await image.decode();
}

export function prefetchProductAsset(product: Product): void {
    const image = productImage(product);
    if (image) prefetchStorefrontImage(image, 'detail');
}

export function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const image = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    const displayName = variant.name ? `${variant.product.name} ${variant.name}` : variant.product.name;

    if (!image || image.includes('placeholder') || image.includes('default-hero')) {
        const { brand } = parseAiProductInfo(displayName);
        return brand === 'generic' ? (
            <div className="image-placeholder" aria-hidden="true">
                <Package />
            </div>
        ) : (
            <AiProductCover name={displayName} />
        );
    }

    return image ? (
        <SafeImage src={image} alt={alt} imageKind="thumbnail" loading="lazy" />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

type SafeImageProps = {
    src: string;
    fallbackSrc?: string;
    placeholderSrc?: string;
    alt: string;
    imageKind?: StorefrontImageKind;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError'>;

export function SafeImage(props: SafeImageProps) {
    const sourceIdentity = [props.src, props.fallbackSrc ?? '', props.imageKind ?? ''].join('\u0000');
    return <SafeImageSource key={sourceIdentity} {...props} />;
}

function SafeImageSource({
    src,
    fallbackSrc,
    placeholderSrc,
    alt,
    imageKind,
    onLoad,
    className,
    ...imageProps
}: SafeImageProps) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [failed, setFailed] = useState(false);
    const [useResponsiveSource, setUseResponsiveSource] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);

    const responsiveSource = useMemo(
        () => (imageKind && useResponsiveSource ? responsiveImageSources(currentSrc, imageKind) : null),
        [currentSrc, imageKind, useResponsiveSource],
    );
    const effectivePlaceholderSrc =
        (placeholderSrc && imageKind
            ? (storefrontPlaceholderUrl(placeholderSrc, imageKind) ?? placeholderSrc)
            : placeholderSrc) ?? responsiveSource?.placeholderSrc;
    const highPriority = imageProps.fetchPriority === 'high';

    useEffect(() => {
        const imageElement = imageRef.current;
        if (!imageElement?.complete || imageElement.naturalWidth < 1) return;
        let cancelled = false;
        void imageElement
            .decode()
            .catch(() => undefined)
            .then(() => {
                if (!cancelled && imageRef.current === imageElement) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [currentSrc, responsiveSource]);

    if (failed) {
        return (
            <span
                className="image-placeholder"
                role={alt ? 'img' : undefined}
                aria-label={alt || undefined}
                aria-hidden={alt ? undefined : true}
            >
                <Package aria-hidden="true" />
            </span>
        );
    }

    const image = (
        <img
            {...imageProps}
            ref={imageRef}
            src={responsiveSource?.fallbackSrc ?? currentSrc}
            srcSet={responsiveSource?.fallbackSrcSet ?? imageProps.srcSet}
            sizes={responsiveSource?.sizes ?? imageProps.sizes}
            width={imageProps.width ?? responsiveSource?.width}
            height={imageProps.height ?? responsiveSource?.height}
            decoding={imageProps.decoding ?? 'async'}
            className={`safe-image${loaded ? ' is-loaded' : ''}${className ? ` ${className}` : ''}`}
            alt={alt}
            onLoad={event => {
                const imageElement = event.currentTarget;
                void imageElement
                    .decode()
                    .catch(() => undefined)
                    .then(() => {
                        if (imageRef.current !== imageElement) return;
                        setLoaded(true);
                        onLoad?.(event);
                    });
            }}
            onError={() => {
                if (responsiveSource) {
                    setUseResponsiveSource(false);
                    return;
                }
                if (fallbackSrc && currentSrc !== fallbackSrc) {
                    setCurrentSrc(fallbackSrc);
                    setUseResponsiveSource(true);
                } else {
                    setFailed(true);
                }
            }}
        />
    );

    const frameClassName = `responsive-picture safe-image-frame${loaded ? ' is-loaded' : ''}${
        highPriority ? ' is-priority' : ''
    }${effectivePlaceholderSrc ? ' has-placeholder' : ''}`;
    const frameStyle = effectivePlaceholderSrc
        ? { backgroundImage: `url(${JSON.stringify(effectivePlaceholderSrc)})` }
        : undefined;

    return responsiveSource ? (
        <picture className={frameClassName} style={frameStyle}>
            <source type="image/webp" srcSet={responsiveSource.webpSrcSet} sizes={responsiveSource.sizes} />
            {image}
        </picture>
    ) : (
        <span className={frameClassName} style={frameStyle}>
            {image}
        </span>
    );
}

export function OrderImage({ order }: { order: OrderSummary }) {
    const variant = order.lines[0]?.productVariant;
    return variant ? (
        <ProductVariantImage variant={variant} alt={variant.name} />
    ) : (
        <div className="image-placeholder" aria-hidden="true">
            <Package />
        </div>
    );
}

export function productImage(product?: Product | null): string | null {
    return product?.featuredAsset?.preview ?? product?.assets?.[0]?.preview ?? null;
}

export function collectionImage(collection: CollectionSummary): string | null {
    return (
        collection.featuredAsset?.preview ??
        collection.children?.find(child => child.featuredAsset?.preview)?.featuredAsset?.preview ??
        null
    );
}

export function minimumProductPrice(product: Product): number {
    return Math.min(...product.variants.map(variant => variant.priceWithTax), Number.MAX_SAFE_INTEGER);
}

export function trimText(value: string | undefined, length: number): string {
    if (!value) return '';
    const clean = value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

export function contentNumberSetting(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function contentStringArraySetting(value: unknown): string[] {
    return Array.isArray(value)
        ? Array.from(
              new Set(value.flatMap(item => (typeof item === 'string' && item.trim() ? [item.trim()] : []))),
          )
        : [];
}

export function formatMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}

export function PriceDisplay({
    value,
    currency,
    locale,
    className,
}: {
    value: number;
    currency: string;
    locale: string;
    className?: string;
}) {
    const formatted = formatMoney(value, currency, locale);
    const match = formatted.match(/^([^\d\s]*)\s*(\d[\d,]*)(?:\.(\d+))?$/);
    if (!match) {
        return <span className={`price-lockup ${className ?? ''}`}>{formatted}</span>;
    }
    const [, symbol, integerPart, decimalPart] = match;
    return (
        <span className={`price-lockup ${className ?? ''}`}>
            <span className="price-symbol">{symbol}</span>
            <span className="price-integer">{integerPart}</span>
            {decimalPart && <span className="price-decimal">.{decimalPart}</span>}
        </span>
    );
}

export function renderColorfulQuickIcon(label: string, index: number, imageUrl?: string | null): ReactNode {
    const cleanLabel = (label || '').toLowerCase();

    if (cleanLabel.includes('代充') || cleanLabel.includes('充值') || cleanLabel.includes('topup')) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #FF5E62 0%, #FF9966 100%)', color: '#fff' }}
            >
                <Zap style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }} />
            </span>
        );
    }
    if (
        cleanLabel.includes('中转') ||
        cleanLabel.includes('api') ||
        cleanLabel.includes('hub') ||
        cleanLabel.includes('ai')
    ) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)', color: '#fff' }}
            >
                <Cpu style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }} />
            </span>
        );
    }
    if (cleanLabel.includes('apple') || cleanLabel.includes('苹果') || cleanLabel.includes('服务')) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)', color: '#fff' }}
            >
                <Smartphone
                    style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }}
                />
            </span>
        );
    }
    if (
        cleanLabel.includes('海外') ||
        cleanLabel.includes('账号') ||
        cleanLabel.includes('global') ||
        cleanLabel.includes('account')
    ) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)', color: '#fff' }}
            >
                <Globe style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }} />
            </span>
        );
    }
    if (
        cleanLabel.includes('保障') ||
        cleanLabel.includes('售后') ||
        cleanLabel.includes('质保') ||
        cleanLabel.includes('support')
    ) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)', color: '#fff' }}
            >
                <ShieldCheck
                    style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }}
                />
            </span>
        );
    }
    if (cleanLabel.includes('券') || cleanLabel.includes('coupon')) {
        return (
            <span
                className="colorful-icon-badge"
                style={{ background: 'linear-gradient(135deg, #DC2626 0%, #F87171 100%)', color: '#fff' }}
            >
                <TicketPercent
                    style={{ width: 22, height: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }}
                />
            </span>
        );
    }

    if (imageUrl) {
        return (
            <span className="colorful-icon-img-wrap">
                <SafeImage src={imageUrl} alt="" imageKind="thumbnail" />
            </span>
        );
    }

    const fallbacks = [
        <span
            key="1"
            className="colorful-icon-badge"
            style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', color: '#fff' }}
        >
            <LayoutGrid style={{ width: 22, height: 22 }} />
        </span>,
        <span
            key="2"
            className="colorful-icon-badge"
            style={{ background: 'linear-gradient(135deg, #EC4899 0%, #F43F5E 100%)', color: '#fff' }}
        >
            <ShoppingBag style={{ width: 22, height: 22 }} />
        </span>,
        <span
            key="3"
            className="colorful-icon-badge"
            style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #FB923C 100%)', color: '#fff' }}
        >
            <Sparkles style={{ width: 22, height: 22 }} />
        </span>,
        <span
            key="4"
            className="colorful-icon-badge"
            style={{ background: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)', color: '#fff' }}
        >
            <Download style={{ width: 22, height: 22 }} />
        </span>,
        <span
            key="5"
            className="colorful-icon-badge"
            style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)', color: '#fff' }}
        >
            <ShieldCheck style={{ width: 22, height: 22 }} />
        </span>,
    ];
    return fallbacks[index % fallbacks.length];
}

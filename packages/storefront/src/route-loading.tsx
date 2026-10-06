import { BrandLoadingIndicator } from './brand-loading';

export type RouteSkeletonVariant =
    'home' | 'catalog' | 'detail' | 'services' | 'account' | 'checkout' | 'studio' | 'default';

function isZh(language?: string): boolean {
    if (language) return language === 'zh' || language.startsWith('zh_');
    return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh');
}

export function loadingPageLabel(language?: string): string {
    return isZh(language) ? '正在加载页面' : 'Loading page';
}

export function pageSkeletonVariantForPathname(pathname: string): RouteSkeletonVariant {
    pathname = pathname.split(/[?#]/u, 1)[0] ?? pathname;
    if (pathname === '/' || pathname === '') return 'home';
    if (/^\/(?:category|search|flash-sale|recommendations|favorites|history)(?:\/|$)/u.test(pathname)) {
        return 'catalog';
    }
    if (/^\/(?:product|order-detail|order-confirmation)(?:\/|$)/u.test(pathname)) return 'detail';
    if (/^\/(?:services|support)(?:\/|$)/u.test(pathname)) return 'services';
    if (/^\/image-studio(?:\/|$)/u.test(pathname)) return 'studio';
    if (
        /^\/(?:account|orders|logistics|addresses|account-security|coupons|referral|notifications|announcements|reviews)(?:\/|$)/u.test(
            pathname,
        )
    ) {
        return 'account';
    }
    if (/^\/(?:cart|checkout|purchase|payment)(?:\/|$)/u.test(pathname)) return 'checkout';
    return 'default';
}

export function PageSkeleton({
    label = 'Loading',
    language,
    variant = 'default',
    root = false,
    compact = false,
}: {
    label?: string;
    language?: string;
    variant?: RouteSkeletonVariant;
    root?: boolean;
    compact?: boolean;
}) {
    const ariaLabel = label === 'Loading' ? loadingPageLabel(language) : label;
    const Tag = root ? 'main' : 'div';
    return (
        <Tag
            data-page-pending="data"
            className={`page-skeleton page-skeleton--route page-skeleton--${variant}${compact ? ' page-skeleton--compact' : ''}`}
            role="status"
            aria-label={ariaLabel}
            aria-busy="true"
        >
            <BrandLoadingIndicator language={language} local={compact} label={ariaLabel} />
        </Tag>
    );
}

export function RouteTransitionLoader({
    language,
    logoUrl,
    storefrontName,
}: {
    language?: string;
    logoUrl?: string | null;
    storefrontName?: string;
}) {
    return (
        <div
            data-page-pending="module"
            className="route-transition"
            role="status"
            aria-label={loadingPageLabel(language)}
            aria-live="polite"
            aria-busy="true"
        >
            <BrandLoadingIndicator language={language} logoUrl={logoUrl} storefrontName={storefrontName} />
        </div>
    );
}

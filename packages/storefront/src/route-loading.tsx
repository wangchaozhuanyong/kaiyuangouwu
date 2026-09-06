import { NEUTRAL_STOREFRONT_IMAGE } from './storefront-images';
import { DEFAULT_STOREFRONT_NAMES } from './storefront-utils';

export type RouteSkeletonVariant =
    'home' | 'catalog' | 'detail' | 'services' | 'account' | 'checkout' | 'default';

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
    if (/^\/(?:services|support|image-studio)(?:\/|$)/u.test(pathname)) return 'services';
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

function SkeletonBar({ className }: { className?: string }) {
    return <span className={className} aria-hidden="true" />;
}

export function PageSkeleton({
    label = 'Loading',
    language,
    variant = 'default',
    root = false,
}: {
    label?: string;
    language?: string;
    variant?: RouteSkeletonVariant;
    root?: boolean;
}) {
    const content = (
        <>
            {variant === 'catalog' ? (
                <>
                    <SkeletonBar className="skeleton-route-header" />
                    <span className="skeleton-chip-row" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                    <span className="skeleton-catalog-list" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                </>
            ) : variant === 'detail' ? (
                <>
                    <SkeletonBar className="skeleton-detail-media" />
                    <span className="skeleton-detail-copy" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                </>
            ) : variant === 'services' ? (
                <>
                    <SkeletonBar className="skeleton-route-header" />
                    <span className="skeleton-service-grid" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                </>
            ) : variant === 'account' ? (
                <>
                    <SkeletonBar className="skeleton-account-card" />
                    <span className="skeleton-account-grid" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                </>
            ) : variant === 'checkout' ? (
                <>
                    <SkeletonBar className="skeleton-checkout-card" />
                    <SkeletonBar className="skeleton-checkout-action" />
                </>
            ) : (
                <>
                    <SkeletonBar className="skeleton-hero" />
                    <SkeletonBar className="skeleton-line" />
                    <span className="skeleton-home-grid" aria-hidden="true">
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                        <SkeletonBar />
                    </span>
                    <SkeletonBar className="skeleton-block" />
                    <SkeletonBar className="skeleton-block" />
                </>
            )}
        </>
    );
    const className = `page-skeleton page-skeleton--route page-skeleton--${variant}`;
    const ariaLabel = label === 'Loading' ? loadingPageLabel(language) : label;
    if (root) {
        return (
            <main className={className} role="status" aria-label={ariaLabel} aria-busy="true">
                {content}
            </main>
        );
    }
    return (
        <div className={className} role="status" aria-label={ariaLabel}>
            {content}
        </div>
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
    const localizedStorefrontName =
        storefrontName?.trim() || DEFAULT_STOREFRONT_NAMES[isZh(language) ? 'zh' : 'en'];

    return (
        <div
            className="route-transition"
            role="status"
            aria-label={loadingPageLabel(language)}
            aria-live="polite"
            aria-busy="true"
        >
            <div className="route-transition-card" aria-hidden="true">
                <span className="route-transition-mark">
                    <img
                        src={logoUrl || NEUTRAL_STOREFRONT_IMAGE}
                        alt=""
                        width="160"
                        height="120"
                        decoding="async"
                        fetchPriority="high"
                    />
                </span>
                <strong>{localizedStorefrontName}</strong>
                <span className="route-transition-track">
                    <span />
                </span>
            </div>
        </div>
    );
}

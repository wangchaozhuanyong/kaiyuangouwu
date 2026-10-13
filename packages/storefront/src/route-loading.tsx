import { publicUnlocalizedPathname } from '../../storefront-content-plugin/src/shared/public-page-data';

import { BrandLoadingIndicator } from './brand-loading';
import { ProductSkeletonItems } from './components/common/product-skeleton';
import { PageReadinessError, usePageLoadingState, usePageReadiness } from './page-readiness';

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
    pathname = publicUnlocalizedPathname(pathname);
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
    usePageReadiness(true, compact ? 'local' : 'page');
    const readiness = usePageLoadingState();
    const failed = readiness?.phase === 'error';
    const ariaLabel = label === 'Loading' ? loadingPageLabel(language) : label;
    const Tag = root ? 'main' : 'div';
    // The boundary owns the one initial brand; keep this component mounted for registration.
    if (readiness?.initial) return null;
    const initialBrand = root && !readiness;
    const className = [
        'page-skeleton page-skeleton--route',
        `page-skeleton--${variant}`,
        initialBrand ? 'page-skeleton--brand' : 'page-skeleton--structure',
        ...(compact ? ['page-skeleton--compact'] : []),
    ].join(' ');
    return (
        <Tag
            data-page-pending={failed ? undefined : 'data'}
            className={className}
            role={failed ? undefined : 'status'}
            aria-label={failed ? undefined : ariaLabel}
            aria-busy={!failed}
        >
            {failed && readiness ? (
                <PageReadinessError state={readiness} inline />
            ) : initialBrand ? (
                <BrandLoadingIndicator language={language} label={ariaLabel} />
            ) : (
                <RouteSkeletonContent variant={variant} compact={compact} />
            )}
        </Tag>
    );
}

/** Structural placeholders only. The shared shell and the readiness boundary own navigation and branding. */
function RouteSkeletonContent({
    variant,
    compact = false,
}: {
    variant: RouteSkeletonVariant;
    compact?: boolean;
}) {
    if (compact) {
        return (
            <div className="route-static-skeleton" aria-hidden="true">
                <span className="skeleton-block skeleton-heading" />
                <span className="skeleton-block skeleton-row" />
            </div>
        );
    }
    if (variant === 'catalog' || variant === 'home') {
        return (
            <div className="route-static-skeleton" aria-hidden="true">
                <span
                    className={`skeleton-block ${variant === 'home' ? 'skeleton-banner' : 'skeleton-heading'}`}
                />
                <div className="route-skeleton-products">
                    <ProductSkeletonItems count={variant === 'home' ? 6 : 12} layout="products" />
                </div>
            </div>
        );
    }
    if (variant === 'detail') {
        return (
            <div className="route-static-skeleton route-detail-skeleton" aria-hidden="true">
                <span className="skeleton-block skeleton-media" />
                <div className="route-static-skeleton route-detail-skeleton-copy">
                    <span className="skeleton-block skeleton-heading" />
                    <span className="skeleton-block skeleton-text" />
                    <span className="skeleton-block skeleton-price" />
                    <span className="skeleton-block skeleton-row" />
                    <span className="skeleton-block skeleton-action" />
                </div>
            </div>
        );
    }
    return (
        <div className="route-static-skeleton" aria-hidden="true">
            <span className="skeleton-block skeleton-heading" />
            {variant === 'checkout' ? (
                <div className="product-list">
                    <ProductSkeletonItems count={3} layout="rows" />
                </div>
            ) : (
                <div
                    className={
                        variant === 'services' || variant === 'studio'
                            ? 'route-skeleton-panels'
                            : 'route-static-skeleton'
                    }
                >
                    <span className="skeleton-block skeleton-row" />
                    <span className="skeleton-block skeleton-row" />
                    <span className="skeleton-block skeleton-row" />
                </div>
            )}
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
    usePageReadiness(true, 'page');
    const readiness = usePageLoadingState();
    const failed = readiness?.phase === 'error';
    if (readiness?.initial) return null;
    return (
        <div
            data-page-pending={failed ? undefined : 'module'}
            className="route-transition"
            role={failed ? undefined : 'status'}
            aria-label={failed ? undefined : loadingPageLabel(language)}
            aria-live="polite"
            aria-busy={!failed}
        >
            {failed && readiness ? (
                <PageReadinessError state={readiness} inline />
            ) : readiness ? (
                <RouteSkeletonContent variant="default" />
            ) : (
                <BrandLoadingIndicator
                    language={language}
                    logoUrl={logoUrl}
                    storefrontName={storefrontName}
                    local={Boolean(readiness)}
                    label={loadingPageLabel(language)}
                />
            )}
        </div>
    );
}

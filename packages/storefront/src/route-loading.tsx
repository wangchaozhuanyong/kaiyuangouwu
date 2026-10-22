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
    onRetry,
}: {
    label?: string;
    language?: string;
    variant?: RouteSkeletonVariant;
    root?: boolean;
    compact?: boolean;
    onRetry?: () => void;
}) {
    usePageReadiness(true, compact ? 'optional' : 'page');
    const readiness = usePageLoadingState(compact ? { pending: true } : undefined);
    const failed = readiness?.phase === 'error' || readiness?.slow;
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
            data-page-pending={readiness?.phase === 'error' ? undefined : 'data'}
            className={className}
            role={failed ? undefined : readiness && !compact ? 'region' : 'status'}
            aria-label={failed ? undefined : ariaLabel}
            aria-busy={readiness?.phase !== 'error'}
        >
            {failed && readiness ? (
                <div className={compact ? undefined : 'page-readiness-overlay'}>
                    <PageReadinessError
                        state={
                            onRetry ? { ...readiness, retry: () => readiness.retryRead(onRetry) } : readiness
                        }
                        inline={compact}
                    />
                </div>
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
    const blocks = (names: string) =>
        names
            .split(' ')
            .map((name, index) => <span className={`skeleton-block skeleton-${name}`} key={index} />);
    const catalog = !compact && variant === 'catalog';
    const detail = !compact && variant === 'detail';
    const products = (
        <ProductSkeletonItems count={catalog ? 12 : 6} layout="products" responsiveRow={catalog} />
    );
    const baseClass = 'route-static-skeleton';
    return (
        <div
            className={`${baseClass}${catalog ? ' skeleton-catalog' : detail ? ' route-detail-skeleton' : ''}`}
            aria-hidden="true"
        >
            {compact ? (
                blocks('heading row')
            ) : catalog ? (
                <>
                    <div className="route-catalog-sidebar">
                        {blocks('search')}
                        <div className="skeleton-cats">{blocks('box box box box')}</div>
                    </div>
                    <div className="route-catalog-results">
                        {blocks('sort')}
                        <div className="skeleton-grid">{products}</div>
                    </div>
                </>
            ) : variant === 'home' ? (
                <>
                    {blocks('banner')}
                    <div className="route-skeleton-products">{products}</div>
                </>
            ) : detail ? (
                <>
                    {blocks('media')}
                    <div className={`${baseClass} route-detail-skeleton-copy`}>
                        {blocks('heading text price row action')}
                    </div>
                </>
            ) : (
                <>
                    {blocks('heading')}
                    {variant === 'checkout' ? (
                        <div className="product-list">
                            <ProductSkeletonItems count={3} layout="rows" />
                        </div>
                    ) : (
                        <div
                            className={
                                variant === 'services' || variant === 'studio'
                                    ? 'route-skeleton-panels'
                                    : baseClass
                            }
                        >
                            {blocks('row row row')}
                        </div>
                    )}
                </>
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
    const failed = readiness?.phase === 'error' || readiness?.slow;
    if (readiness?.initial) return null;
    return (
        <div
            data-page-pending={readiness?.phase === 'error' ? undefined : 'module'}
            className="route-transition"
            role={failed ? undefined : readiness ? 'region' : 'status'}
            aria-label={failed ? undefined : loadingPageLabel(language)}
            aria-live={readiness ? undefined : 'polite'}
            aria-busy={readiness?.phase !== 'error'}
        >
            {failed && readiness ? (
                <div className="page-readiness-overlay">
                    <PageReadinessError state={readiness} />
                </div>
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

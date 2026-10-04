import { Store } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { normalizeStorefrontAssetUrl, storefrontWebpUrl } from './responsive-image';
import { DEFAULT_STOREFRONT_NAMES } from './storefront-utils';

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
}: {
    label?: string;
    language?: string;
    variant?: RouteSkeletonVariant;
    root?: boolean;
}) {
    const ariaLabel = label === 'Loading' ? loadingPageLabel(language) : label;
    const content = (
        <span className="page-loading-indicator">
            <span className="page-loading-spinner" aria-hidden="true" />
            <span>{ariaLabel}</span>
        </span>
    );
    const className = `page-skeleton page-skeleton--route page-skeleton--${variant}`;
    if (root) {
        return (
            <main
                data-page-pending="data"
                className={className}
                role="status"
                aria-label={ariaLabel}
                aria-busy="true"
            >
                {content}
            </main>
        );
    }
    return (
        <div
            data-page-pending="data"
            className={className}
            role="status"
            aria-label={ariaLabel}
            aria-busy="true"
        >
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
    const logoSource = normalizeStorefrontAssetUrl(logoUrl ?? '');

    return (
        <div
            data-page-pending="module"
            className="route-transition"
            role="status"
            aria-label={loadingPageLabel(language)}
            aria-live="polite"
            aria-busy="true"
        >
            <div className="route-transition-card" aria-hidden="true">
                <RouteTransitionLogo key={logoSource} source={logoSource} />
                <strong>{localizedStorefrontName}</strong>
                <span className="route-transition-track">
                    <span />
                </span>
            </div>
        </div>
    );
}

function RouteTransitionLogo({ source }: { source: string }) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [originalSource, setOriginalSource] = useState(false);
    const [failed, setFailed] = useState(false);
    const [readySource, setReadySource] = useState('');
    const src = source ? (originalSource ? source : storefrontWebpUrl(source, 'thumbnail')) : '';
    const ready = Boolean(src && readySource === src && !failed);

    function reveal(image: HTMLImageElement) {
        const show = () => {
            if (imageRef.current === image && image.getAttribute('src') === src && image.naturalWidth > 0) {
                setReadySource(src);
            }
        };
        if (typeof image.decode === 'function') {
            void image.decode().then(show, show);
        } else {
            show();
        }
    }

    useLayoutEffect(() => {
        const image = imageRef.current;
        // A cached image can finish before React attaches its load listener.
        if (image?.complete && image.naturalWidth > 0) reveal(image);
    }, [src]);

    return (
        <span className={`route-transition-mark${ready ? ' is-logo-ready' : ''}`}>
            {!ready && <Store className="route-transition-placeholder" aria-hidden="true" />}
            {src && !failed && (
                <img
                    ref={imageRef}
                    src={src}
                    alt=""
                    width="160"
                    height="120"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    onLoad={event => reveal(event.currentTarget)}
                    onError={() => {
                        if (src !== source) setOriginalSource(true);
                        else setFailed(true);
                    }}
                />
            )}
        </span>
    );
}

// organize-imports-ignore
import type { BrandLoadingProps } from './brand-loading';
import { useContext, useLayoutEffect, useRef, useState } from 'react';

import { normalizeStorefrontAssetUrl, storefrontWebpUrl } from './responsive-image';
import { readInitialPublicPage } from './storefront-page-data';
import { StorefrontContext } from './StorefrontContext';

/** Presentation only: uses the current store owner, never a persisted brand cache or a new request. */
export default function BrandLoadingContent({
    language,
    logoUrl,
    storefrontName,
    compact = false,
    local = false,
    label,
}: BrandLoadingProps) {
    const context = useContext(StorefrontContext);
    // Root router pending renders outside the provider. Only the validated server payload may brand it.
    const initialPage = context ? undefined : readInitialPublicPage();
    const resolvedLanguage = language ?? context?.language ?? initialPage?.scope.languageCode ?? 'zh';
    const chinese = resolvedLanguage === 'zh' || resolvedLanguage.startsWith('zh_');
    const config = initialPage?.config;
    const source = normalizeStorefrontAssetUrl(
        logoUrl !== undefined ? (logoUrl ?? '') : (context?.logoUrl ?? config?.logoUrl ?? ''),
    );
    const name =
        storefrontName ??
        context?.storefrontName ??
        (chinese ? config?.customFields.storefrontNameZh : config?.customFields.storefrontNameEn);

    if (local) {
        return (
            <span className="page-loading-indicator">
                <span className="brand-loading-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </span>
                <span>{label}</span>
            </span>
        );
    }

    return (
        <span className={`brand-loading${compact ? ' brand-loading--compact' : ''}`} aria-hidden="true">
            <BrandLoadingLogo key={source} source={source} />
            {compact && label && <span>{label}</span>}
            {!compact && name?.trim() && <strong className="brand-loading-name">{name.trim()}</strong>}
            <span className="brand-loading-dots">
                <i />
                <i />
                <i />
            </span>
        </span>
    );
}

function BrandLoadingLogo({ source }: { source: string }) {
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

    if (!src || failed) return null;

    return (
        <span className={`route-transition-mark${ready ? ' is-logo-ready' : ''}`}>
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

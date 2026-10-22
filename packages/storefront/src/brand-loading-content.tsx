// organize-imports-ignore
import type { BrandLoadingProps } from './brand-loading';
import { useContext } from 'react';

import { normalizeStorefrontAssetUrl, storefrontWebpUrl } from './responsive-image';
import { SafeImage } from './safe-image';
import { readInitialStorefrontBoot } from './storefront-boot-data';
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
    pending = true,
}: BrandLoadingProps) {
    const context = useContext(StorefrontContext);
    // Root router pending renders outside the provider. Only the validated server payload may brand it.
    const initialPage = context ? undefined : (readInitialPublicPage() ?? readInitialStorefrontBoot());
    const resolvedLanguage = language ?? context?.language ?? initialPage?.scope.languageCode ?? 'zh';
    const chinese = resolvedLanguage === 'zh' || resolvedLanguage.startsWith('zh_');
    const known = !context || Boolean(context.storefrontCode);
    const config = context
        ? context.configQuery?.data && context.configQuery.data.code === context.storefrontCode
            ? context.configQuery.data
            : undefined
        : initialPage?.config;
    const source = normalizeStorefrontAssetUrl(
        known ? (logoUrl !== undefined ? (logoUrl ?? '') : (context?.logoUrl ?? config?.logoUrl ?? '')) : '',
    );
    const name = known
        ? (
              storefrontName ??
              context?.storefrontName ??
              (chinese ? config?.customFields.storefrontNameZh : config?.customFields.storefrontNameEn)
          )?.trim()
        : '';
    const secondaryName = chinese ? config?.customFields.storefrontNameEn?.trim() : '';
    const owner = JSON.stringify([context?.storefrontCode ?? initialPage?.scope.channelCode, source]);
    const loadingLabel =
        label ?? (chinese ? (name ? '正在加载' : '正在连接') : name ? 'Loading' : 'Connecting');

    if (local) {
        return (
            <span className="page-loading-indicator">
                <BrandLoadingLogo key={owner} source={source} />
                <span>{loadingLabel}</span>
                {pending && (
                    <span className="brand-loading-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                    </span>
                )}
            </span>
        );
    }

    return (
        <span className={`brand-loading${compact ? ' brand-loading--compact' : ''}`} aria-hidden="true">
            <BrandLoadingLogo key={owner} source={source} reserveSpace={!compact} />
            {compact && label && <span>{label}</span>}
            {!compact && <strong className="brand-loading-name">{name}</strong>}
            {!compact && (
                <span className="brand-loading-subtitle">
                    {name && secondaryName !== name ? secondaryName : ''}
                </span>
            )}
            {pending && (
                <span className="brand-loading-caption">
                    {!compact && <span>{loadingLabel}</span>}
                    {compact ? (
                        <span className="brand-loading-dots">
                            <i />
                            <i />
                            <i />
                        </span>
                    ) : (
                        <span className="brand-loading-bar">
                            <i />
                        </span>
                    )}
                </span>
            )}
        </span>
    );
}

function BrandLoadingLogo({ source, reserveSpace = false }: { source: string; reserveSpace?: boolean }) {
    if (!source && !reserveSpace) return null;

    return (
        <span className="route-transition-mark">
            {source && (
                <SafeImage
                    src={storefrontWebpUrl(source, 'thumbnail')}
                    fallbackSrc={source}
                    alt=""
                    aria-hidden="true"
                    width="160"
                    height="120"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    showFallbackIcon={false}
                    loadingFallback={null}
                    errorFallback={<span />}
                />
            )}
        </span>
    );
}

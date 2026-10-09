import { Component, ErrorInfo, ReactNode, useState } from 'react';

import { normalizeStorefrontAssetUrl, storefrontWebpUrl } from './responsive-image';

interface StorefrontRecoveryScope {
    channelCode: string;
    currencyCode: string;
    languageCode: string;
}

interface StorefrontRecoveryBrand {
    channelCode: string;
    name: string;
    logoUrl: string | null;
}

interface RecoveryOwner {
    document: Document;
    origin: string;
    scopeKey: string;
    channelCode: string;
}

// This is a single committed presentation record for a render crash in this document,
// not a query cache. Never restore branding from sessionStorage or a previous document.
let recovery: { owner: RecoveryOwner; brand: StorefrontRecoveryBrand | null } | null = null;

/** Called synchronously before descendant hooks can throw, so a store switch clears old branding. */
export function beginStorefrontRecoveryScope(scope: StorefrontRecoveryScope): RecoveryOwner | null {
    if (
        typeof document === 'undefined' ||
        typeof window === 'undefined' ||
        !scope.channelCode.trim() ||
        !scope.currencyCode.trim() ||
        !scope.languageCode.trim()
    ) {
        recovery = null;
        return null;
    }
    const scopeKey = JSON.stringify([scope.channelCode, scope.currencyCode, scope.languageCode]);
    if (
        recovery?.owner.document !== document ||
        recovery.owner.origin !== window.location.origin ||
        recovery.owner.scopeKey !== scopeKey
    ) {
        recovery = {
            owner: { document, origin: window.location.origin, scopeKey, channelCode: scope.channelCode },
            brand: null,
        };
    }
    return recovery.owner;
}

/** Commit only a confirmed brand; a stale owner cannot publish after an A → B → A switch. */
export function setStorefrontRecoveryBrand(
    owner: RecoveryOwner | null,
    brand: StorefrontRecoveryBrand | null,
): void {
    if (!owner || recovery?.owner !== owner) return;
    recovery.brand =
        owner.document === document &&
        owner.origin === window.location.origin &&
        brand?.channelCode === owner.channelCode
            ? {
                  channelCode: brand.channelCode,
                  name: brand.name.trim(),
                  logoUrl: normalizeStorefrontAssetUrl(brand.logoUrl ?? '') || null,
              }
            : null;
}

function currentRecoveryBrand(): StorefrontRecoveryBrand | null {
    if (recovery?.owner.document !== document || recovery.owner.origin !== window.location.origin) {
        recovery = null;
        return null;
    }
    return recovery.brand;
}

function RecoveryLogo({ source }: { source: string }) {
    const [original, setOriginal] = useState(false);
    const [failed, setFailed] = useState(false);
    const src = original ? source : storefrontWebpUrl(source, 'thumbnail');
    if (failed) return null;
    return (
        <span className="route-transition-mark is-logo-ready">
            <img
                src={src}
                alt=""
                onError={() => {
                    if (src !== source) setOriginal(true);
                    else setFailed(true);
                }}
            />
        </span>
    );
}

interface StorefrontErrorBoundaryProps {
    children: ReactNode;
}

interface StorefrontErrorBoundaryState {
    failed: boolean;
}

export class StorefrontErrorBoundary extends Component<
    StorefrontErrorBoundaryProps,
    StorefrontErrorBoundaryState
> {
    state: StorefrontErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): StorefrontErrorBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        document.documentElement.removeAttribute('data-storefront-theme-pending');
        // Rendering failures must remain visible in production diagnostics.
        // eslint-disable-next-line no-console
        console.error('Storefront render failed', error, errorInfo);
    }

    render() {
        if (!this.state.failed) return this.props.children;

        const isZh = document.documentElement.lang.toLowerCase().startsWith('zh');
        const brand = currentRecoveryBrand();
        return (
            <main className="fatal-error-page" role="alert">
                {brand && (brand.name || brand.logoUrl) ? (
                    <span className="brand-loading">
                        {brand.logoUrl && <RecoveryLogo key={brand.logoUrl} source={brand.logoUrl} />}
                        {brand.name && <strong className="brand-loading-name">{brand.name}</strong>}
                    </span>
                ) : null}
                <h1>{isZh ? '页面暂时无法显示' : 'This page could not be displayed'}</h1>
                <p>
                    {isZh
                        ? '内容没有丢失，请重新加载后再试。'
                        : 'Your data is still available. Reload the page to try again.'}
                </p>
                <button type="button" onClick={() => window.location.reload()}>
                    {isZh ? '重新加载' : 'Reload'}
                </button>
            </main>
        );
    }
}

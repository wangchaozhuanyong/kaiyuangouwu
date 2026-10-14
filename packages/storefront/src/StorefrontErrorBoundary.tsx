import { Component, ErrorInfo, ReactNode, useState } from 'react';

import { applyInitialLoadingBrand } from './brand-loading-bootstrap';
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
    secondaryName?: string;
}

interface RecoveryOwner {
    document: Document;
    origin: string;
    scopeKey: string;
    channelCode: string;
    languageCode: 'en' | 'zh_Hans';
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
        if (recovery && typeof document !== 'undefined')
            applyInitialLoadingBrand({
                language: document.documentElement.lang.startsWith('zh') ? 'zh_Hans' : 'en',
                storefrontName: '',
                logoUrl: '',
            });
        recovery = null;
        return null;
    }
    const scopeKey = JSON.stringify([scope.channelCode, scope.currencyCode, scope.languageCode]);
    if (
        recovery?.owner.document !== document ||
        recovery.owner.origin !== window.location.origin ||
        recovery.owner.scopeKey !== scopeKey
    ) {
        const replacingCurrentDocumentOwner = recovery?.owner.document === document;
        recovery = {
            owner: {
                document,
                origin: window.location.origin,
                scopeKey,
                channelCode: scope.channelCode,
                languageCode: scope.languageCode === 'en' ? 'en' : 'zh_Hans',
            },
            brand: null,
        };
        if (replacingCurrentDocumentOwner)
            applyInitialLoadingBrand({
                language: recovery.owner.languageCode,
                storefrontName: '',
                logoUrl: '',
            });
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
                  secondaryName: brand.secondaryName?.trim(),
              }
            : null;
    applyInitialLoadingBrand({
        language: owner.languageCode,
        storefrontName: recovery.brand?.name ?? '',
        secondaryName: recovery.brand?.secondaryName,
        logoUrl: recovery.brand?.logoUrl ?? '',
    });
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
        document.dispatchEvent(new Event('storefront:page-error'));
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

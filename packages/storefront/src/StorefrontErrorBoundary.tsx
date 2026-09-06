import { Component, ErrorInfo, ReactNode } from 'react';

import { storefrontWebpUrl } from './responsive-image';

const LOGO_URL_CACHE_KEY = '__storefront_logo_url__';

/** Cache the logo URL so the error boundary can display it even after a render crash. */
export function cacheLogoUrl(url: string | null): void {
    try {
        if (url) {
            sessionStorage.setItem(LOGO_URL_CACHE_KEY, storefrontWebpUrl(url, 'thumbnail'));
        } else {
            sessionStorage.removeItem(LOGO_URL_CACHE_KEY);
        }
    } catch {
        // Silently ignore storage errors.
    }
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
        // Rendering failures must remain visible in production diagnostics.
        // eslint-disable-next-line no-console
        console.error('Storefront render failed', error, errorInfo);
    }

    render() {
        if (!this.state.failed) return this.props.children;

        const isZh = document.documentElement.lang.toLowerCase().startsWith('zh');
        let cachedLogoUrl: string | null = null;
        try {
            cachedLogoUrl = sessionStorage.getItem(LOGO_URL_CACHE_KEY);
        } catch {
            // Ignore storage errors.
        }
        return (
            <main className="fatal-error-page" role="alert">
                {cachedLogoUrl ? (
                    <img className="fatal-error-mark" src={cachedLogoUrl} alt="" />
                ) : (
                    <span className="fatal-error-mark" aria-hidden="true">
                        ◇
                    </span>
                )}
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

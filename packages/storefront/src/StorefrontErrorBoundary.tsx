import { Component, ErrorInfo, ReactNode } from 'react';

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
        console.error('Storefront render failed', error, errorInfo);
    }

    render() {
        if (!this.state.failed) return this.props.children;

        const isZh = document.documentElement.lang !== 'en';
        return (
            <main className="fatal-error-page" role="alert">
                <span className="fatal-error-mark" aria-hidden="true">
                    桥
                </span>
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

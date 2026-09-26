import { Outlet, lazyRouteComponent } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { WifiOff } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import {
    DesktopAccountNavigation,
    isDesktopAccountRoute,
} from './components/common/desktop-account-navigation';
import { DesktopHeader } from './components/common/desktop-header';
import { DesktopLayoutContext, useDesktopViewport } from './desktop-layout';
import { desktopPageFamily } from './desktop-page-contract';
import { type useStorefrontAppState } from './hooks/useStorefrontAppState';
import { PageReadinessBoundary } from './page-readiness';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { isBrowsingStorefrontRoute, isPublicStorefrontRoute } from './storefront-access';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import { routeHref, storefrontRouteNames, type RouteName } from './storefront-router';
import { StorefrontTrafficPreference } from './storefront-ui/storefront-traffic-preference';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';
import { type ActiveCustomer } from './types';

const LoginRoutePage = lazyRouteComponent(() => import('./route-pages/auth-route-pages'), 'LoginRoutePage');

type StorefrontShellProps = { state: ReturnType<typeof useStorefrontAppState> };

const PREVIEW_CUSTOMER: ActiveCustomer = {
    id: '__storefront_preview_customer__',
    firstName: '预览',
    lastName: '用户',
    emailAddress: 'preview@example.invalid',
    phoneNumber: null,
    avatar: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};

export function StorefrontShell({ state }: StorefrontShellProps) {
    const desktop = useDesktopViewport();
    // Preview identity belongs to this iframe document, not a changing route query string.
    const [previewParameters] = useState(storefrontPreviewParameters);
    const previewEmbedded = previewParameters.get('storefrontPreviewEmbedded') === '1';
    const previewScenario = previewEmbedded ? previewParameters.get('storefrontPreviewScenario') : null;
    const previewSession = previewEmbedded ? previewParameters.get('storefrontPreviewSession') : null;
    const {
        storefrontContextValue,
        online,
        isZh,
        displayedRoute,
        navigationBlock,
        cart,
        toast,
        language,
        customer: sessionCustomer,
        customerLoadState,
        customerLoadError,
        retryAccount,
    } = state;
    const customer = previewEmbedded
        ? previewParameters.get('storefrontPreviewAuth') === 'authenticated'
            ? (sessionCustomer ?? PREVIEW_CUSTOMER)
            : null
        : sessionCustomer;
    const effectiveStorefrontContext =
        customer === storefrontContextValue.customer
            ? storefrontContextValue
            : { ...storefrontContextValue, customer };
    const protectedRoute = !isPublicStorefrontRoute(displayedRoute.name);
    const waitingForAccount = !customer && customerLoadState !== 'ready';
    const accountFailed = customerLoadState === 'error' || customerLoadState === 'paused';
    const showNavigation = isBrowsingStorefrontRoute(displayedRoute.name) || Boolean(customer);
    const readinessIdentity = JSON.stringify([
        storefrontContextValue.storefrontCode,
        language,
        routeHref(displayedRoute),
    ]);
    const skeletonVariant = pageSkeletonVariantForPathname(routeHref(displayedRoute));
    const renderedRouteName = protectedRoute && !customer ? 'login' : displayedRoute.name;

    useEffect(() => {
        if (!previewEmbedded || !previewSession) return;
        const receivePreviewNavigation = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'storefront-preview-navigate') return;
            if (event.data.session !== previewSession) return;
            const nextRoute = event.data.route;
            if (!storefrontRouteNames.includes(nextRoute as RouteName)) return;
            const id = typeof event.data.id === 'string' ? event.data.id : undefined;
            const tab = nextRoute === 'orders' && event.data.tab === 'service' ? 'service' : undefined;
            storefrontContextValue.navigate({ name: nextRoute as RouteName, id, tab }, true);
        };
        window.addEventListener('message', receivePreviewNavigation);
        return () => window.removeEventListener('message', receivePreviewNavigation);
    }, [previewEmbedded, previewSession, storefrontContextValue.navigate]);

    useEffect(() => {
        if (!previewEmbedded || window.parent === window) return;
        if (!previewSession) return;
        window.parent.postMessage(
            { type: 'storefront-preview-ready', session: previewSession },
            window.location.origin,
        );
        window.parent.postMessage(
            { type: 'storefront-preview-route', route: renderedRouteName, session: previewSession },
            window.location.origin,
        );
    }, [previewEmbedded, previewSession, renderedRouteName]);

    return (
        <StorefrontContext.Provider value={effectiveStorefrontContext}>
            <DesktopLayoutContext.Provider value={desktop}>
                <PageReadinessBoundary
                    requestKey={readinessIdentity}
                    navigationKey={readinessIdentity}
                    pending={Boolean(state.pageDataPending || state.isNavigationPending)}
                    online={online}
                    language={language}
                    onRetry={() => window.location.reload()}
                    onBack={storefrontContextValue.goBack ?? (() => window.history.back())}
                >
                    <div
                        data-route={renderedRouteName}
                        data-page-family={desktopPageFamily(renderedRouteName)}
                        data-preview-embedded={previewEmbedded ? 'true' : undefined}
                        className={`storefront-app${online ? '' : ' is-offline'}${desktop ? ' desktop-store-layout' : ''}`}
                    >
                        <a className="skip-link" href="#storefront-content">
                            {isZh ? '跳到主要内容' : 'Skip to content'}
                        </a>
                        {!online && (
                            <div className="network-banner" role="status">
                                <WifiOff aria-hidden="true" />
                                {isZh
                                    ? '当前网络不可用，部分操作可能失败'
                                    : 'You are offline. Some actions may fail.'}
                            </div>
                        )}
                        {desktop && showNavigation && (
                            <DesktopHeader
                                navigationBlock={navigationBlock}
                                cartQuantity={cart?.totalQuantity ?? 0}
                            />
                        )}
                        <div
                            className={
                                desktop
                                    ? customer && isDesktopAccountRoute(displayedRoute.name)
                                        ? 'desktop-shell-frame desktop-account-layout'
                                        : 'desktop-shell-frame'
                                    : undefined
                            }
                        >
                            {desktop && customer && <DesktopAccountNavigation />}
                            <div id="storefront-content" tabIndex={-1}>
                                <Suspense
                                    fallback={
                                        <PageSkeleton variant={skeletonVariant} language={language} root />
                                    }
                                >
                                    {protectedRoute && waitingForAccount ? (
                                        accountFailed ? (
                                            <div role="alert" className="empty-state">
                                                <p>{customerLoadError}</p>
                                                <button type="button" onClick={() => void retryAccount()}>
                                                    {isZh ? '重试' : 'Try again'}
                                                </button>
                                                <a href="/promo">
                                                    {isZh ? '返回介绍页' : 'Back to introduction'}
                                                </a>
                                            </div>
                                        ) : (
                                            <PageSkeleton variant="account" language={language} root />
                                        )
                                    ) : protectedRoute && !customer ? (
                                        <LoginRoutePage />
                                    ) : (
                                        <Outlet />
                                    )}
                                </Suspense>
                                {previewEmbedded &&
                                    previewScenario &&
                                    !['normal', 'dense', 'aftercare'].includes(previewScenario) &&
                                    !(
                                        displayedRoute.name === 'home' &&
                                        ['empty', 'loading'].includes(previewScenario)
                                    ) && <PreviewScenarioPanel scenario={previewScenario} isZh={isZh} />}
                            </div>
                        </div>
                    </div>
                    {!desktop &&
                        showNavigation &&
                        shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
                            <BottomNavigation
                                activeRoute={displayedRoute.name}
                                cartQuantity={cart?.totalQuantity ?? 0}
                                language={language}
                                navigationBlock={navigationBlock}
                            />
                        )}
                    {toast && (
                        <div
                            className={clsx(
                                'toast',
                                typeof toast === 'object' && toast.type && `toast--${toast.type}`,
                            )}
                            role="status"
                            aria-live="polite"
                        >
                            {typeof toast === 'string' ? (
                                toast
                            ) : (
                                <div className="toast-inner">
                                    {toast.type === 'success' && <span className="toast-icon">✓</span>}
                                    {toast.type === 'error' && <span className="toast-icon">✕</span>}
                                    {toast.type === 'warning' && <span className="toast-icon">⚠</span>}
                                    {toast.type === 'info' && <span className="toast-icon">ℹ</span>}
                                    <div className="toast-content">
                                        {toast.title && <div className="toast-title">{toast.title}</div>}
                                        <div className="toast-message">{toast.message}</div>
                                    </div>
                                    {toast.action && (
                                        <button
                                            type="button"
                                            className="toast-action"
                                            onClick={toast.action.onClick}
                                        >
                                            {toast.action.label}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <StorefrontTrafficPreference api={storefrontContextValue.api} language={language} />

                    <StorefrontUpdatePrompt language={language} />
                </PageReadinessBoundary>
            </DesktopLayoutContext.Provider>
        </StorefrontContext.Provider>
    );
}

function PreviewScenarioPanel({ scenario, isZh }: { scenario: string; isZh: boolean }) {
    if (scenario === 'loading') return <PageSkeleton variant="account" language={isZh ? 'zh' : 'en'} root />;
    const content =
        scenario === 'empty'
            ? {
                  title: isZh ? '暂无数据' : 'No data yet',
                  body: isZh ? '当前页面暂无可展示内容。' : 'There is nothing to display on this page.',
              }
            : scenario === 'error'
              ? {
                    title: isZh ? '加载失败' : 'Unable to load',
                    body: isZh ? '请检查网络后重试。' : 'Check your connection and try again.',
                }
              : scenario === 'disabled'
                ? {
                      title: isZh ? '功能暂不可用' : 'Feature unavailable',
                      body: isZh ? '当前操作条件尚未满足。' : 'The requirements for this action are not met.',
                  }
                : {
                      title: isZh ? '确认操作' : 'Confirm action',
                      body: isZh
                          ? '这是用于验收弹窗状态的只读预览。'
                          : 'This read-only preview verifies the dialog state.',
                  };
    return (
        <div
            className={`storefront-preview-scenario is-${scenario}`}
            role={scenario === 'dialog' ? 'dialog' : 'status'}
        >
            <div className="storefront-preview-state-card">
                <strong>{content.title}</strong>
                <p>{content.body}</p>
                <button type="button" disabled={scenario === 'disabled'}>
                    {scenario === 'error' ? (isZh ? '重试' : 'Try again') : isZh ? '知道了' : 'Got it'}
                </button>
            </div>
        </div>
    );
}

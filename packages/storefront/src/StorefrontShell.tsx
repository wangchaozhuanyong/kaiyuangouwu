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
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';
import { type ActiveCustomer } from './types';

const LoginRoutePage = lazyRouteComponent(() => import('./route-pages/auth-route-pages'), 'LoginRoutePage');
const StorefrontTrafficPreference = lazyRouteComponent(
    () => import('./storefront-ui/storefront-traffic-preference'),
    'StorefrontTrafficPreference',
);
const PreviewScenarioPanel = lazyRouteComponent(
    () => import('./storefront-preview-scenario-panel'),
    'PreviewScenarioPanel',
);

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
        if (
            storefrontContextValue.reviewSettingsStatus === 'disabled' &&
            storefrontContextValue.route.name === 'reviews'
        ) {
            storefrontContextValue.navigate({ name: 'account' }, true);
        }
    }, [
        storefrontContextValue.reviewSettingsStatus,
        storefrontContextValue.navigate,
        storefrontContextValue.route.name,
    ]);

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

    // A draft Channel rejects the public configuration request. End the loading shell as soon as
    // that definitive response arrives, without showing another store's cached brand or catalog.
    if (!previewEmbedded && state.storefrontUnavailable) {
        return (
            <main className="fatal-error-page" role="status">
                <span className="fatal-error-mark" aria-hidden="true">
                    ◇
                </span>
                <h1>{isZh ? '店铺暂未开放' : 'Store not open yet'}</h1>
                <p>
                    {isZh
                        ? '店铺目前无法提供商品浏览与下单服务，请稍后再来。'
                        : 'Products and checkout are unavailable for this store right now. Please check back later.'}
                </p>
                <button type="button" onClick={() => void state.retryPageLoad()}>
                    {isZh ? '重新检查' : 'Check again'}
                </button>
            </main>
        );
    }

    return (
        <StorefrontContext.Provider value={effectiveStorefrontContext}>
            <DesktopLayoutContext.Provider value={desktop}>
                <PageReadinessBoundary
                    requestKey={readinessIdentity}
                    navigationKey={readinessIdentity}
                    pending={Boolean(state.pageDataPending || state.isNavigationPending)}
                    navigationPreparing={state.isPreparingProduct}
                    online={online}
                    language={language}
                    onRetry={() => void state.retryPageLoad()}
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
                        {!previewEmbedded && state.storefrontAccessMode === 'PREVIEW' && (
                            <aside className="storefront-preview-notice type-helper" role="status">
                                <strong>{isZh ? '公开预览' : 'Public preview'}</strong>
                                <span>
                                    {isZh
                                        ? '店铺尚未正式营业；测试支付只会生成模拟订单。'
                                        : 'This store is not live yet. Test payments create simulated orders only.'}
                                </span>
                            </aside>
                        )}
                        {desktop && showNavigation && (
                            <DesktopHeader
                                navigationBlock={navigationBlock}
                                cartQuantity={cart?.totalQuantity ?? 0}
                            />
                        )}
                        {!previewEmbedded && (
                            <StorefrontUpdatePrompt language={language} route={renderedRouteName} />
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
                                    !['normal', 'dense', 'aftercare', 'catalog-scroll'].includes(
                                        previewScenario,
                                    ) &&
                                    !(
                                        displayedRoute.name === 'home' &&
                                        ['empty', 'loading'].includes(previewScenario)
                                    ) && (
                                        <Suspense fallback={null}>
                                            <PreviewScenarioPanel scenario={previewScenario} isZh={isZh} />
                                        </Suspense>
                                    )}
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

                    <Suspense fallback={null}>
                        <StorefrontTrafficPreference api={storefrontContextValue.api} language={language} />
                    </Suspense>
                </PageReadinessBoundary>
            </DesktopLayoutContext.Provider>
        </StorefrontContext.Provider>
    );
}

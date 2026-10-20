import { lazyRouteComponent, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';

import { AuthEmailDraftBoundary } from './auth-presentation';
import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import {
    DesktopAccountNavigation,
    isDesktopAccountRoute,
} from './components/common/desktop-account-navigation';
import { DesktopHeader } from './components/common/desktop-header';
import { DesktopLayoutContext, useDesktopViewport } from './desktop-layout';
import { type useStorefrontAppState } from './hooks/useStorefrontAppState';
import { OverlayHost } from './overlay-host';
import { markStorefrontAppOwned, PageReadinessBoundary } from './page-readiness';
import { PageSkeleton, pageSkeletonVariantForPathname } from './route-loading';
import { isBrowsingStorefrontRoute, isPublicStorefrontRoute } from './storefront-access';
import {
    initialStorefrontAssetReferences,
    shouldShowStorefrontUpdatePrompt,
    useDeferredStorefrontUi,
} from './storefront-deferred-ui';
import { readInitialPublicPage } from './storefront-page-data';
import { StorefrontPageFrame } from './storefront-page-frame';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import { routeHref, storefrontRouteNames, type RouteName } from './storefront-router';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import { type ActiveCustomer } from './types';

const StorefrontUpdatePrompt = lazy(() =>
    import('./StorefrontUpdatePrompt').then(module => ({ default: module.StorefrontUpdatePrompt })),
);
const StorefrontTrafficPreference = lazy(() =>
    import('./storefront-ui/storefront-traffic-preference').then(module => ({
        default: module.StorefrontTrafficPreference,
    })),
);

const LoginRoutePage = lazyRouteComponent(() => import('./route-pages/auth-route-pages'), 'LoginRoutePage');
const AuthenticationOverlay = lazyRouteComponent(() => import('./auth-overlay'), 'AuthenticationOverlay');
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

/** One mount owner for non-rendering browser enhancements. */
export function mountStorefrontEnhancements(
    load: () => Promise<{ trackStorefrontEnhancements: () => () => void }> = () =>
        import('./storefront-enhancements'),
) {
    let active = true;
    let initialized = false;
    let loading = false;
    let reconnectQueued = false;
    let dispose: () => void = () => undefined;
    // Native CSS positioning remains the fallback while this small enhancement loads.
    const start = () => {
        if (!active || initialized || navigator.onLine === false) return;
        if (loading) {
            reconnectQueued = true;
            return;
        }
        loading = true;
        reconnectQueued = false;
        void load()
            .then(({ trackStorefrontEnhancements }) => {
                if (active) {
                    dispose = trackStorefrontEnhancements();
                    initialized = true;
                }
            })
            .catch(() => undefined)
            .finally(() => {
                loading = false;
                // Consume a reconnect missed by this pending request once.
                // A failed retry cannot schedule itself without another event.
                if (reconnectQueued) {
                    reconnectQueued = false;
                    start();
                }
            });
    };
    window.addEventListener('online', start);
    start();
    return () => {
        active = false;
        window.removeEventListener('online', start);
        dispose();
    };
}

export function StorefrontShell({ state }: StorefrontShellProps) {
    const router = useRouter();
    const navigationTarget = useRouterState({ select: routerState => routerState.location.href });
    useEffect(() => mountStorefrontEnhancements(), []);
    const desktop = useDesktopViewport();
    // Preview identity belongs to this iframe document, not a changing route query string.
    const [previewParameters] = useState(storefrontPreviewParameters);
    const [requireInitialRouteCommit] = useState(() => Boolean(readInitialPublicPage()));
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
    const authRoute = ['login', 'register', 'forgot-password'].includes(displayedRoute.name);
    const showNavigation = isBrowsingStorefrontRoute(displayedRoute.name) || (!!customer && !authRoute);
    const readinessIdentity = JSON.stringify([
        storefrontContextValue.storefrontCode,
        storefrontContextValue.market.code,
        storefrontContextValue.market.currencyCode,
        customer?.id ?? null,
        language,
        routeHref(displayedRoute),
    ]);
    const skeletonVariant = pageSkeletonVariantForPathname(routeHref(displayedRoute));
    const renderedRouteName = protectedRoute && !customer ? 'login' : displayedRoute.name;
    const deferredUiReady = useDeferredStorefrontUi(
        previewEmbedded || !state.storefrontUnavailable,
        readinessIdentity,
    );

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

    useLayoutEffect(() => {
        if (!previewEmbedded && state.storefrontUnavailable) markStorefrontAppOwned();
    }, [previewEmbedded, state.storefrontUnavailable]);

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
                <OverlayHost ownerKey={readinessIdentity}>
                    <PageReadinessBoundary
                        initialScopeKey={storefrontContextValue.market.code}
                        requireInitialRouteCommit={requireInitialRouteCommit}
                        initialError={
                            !storefrontContextValue.storefrontContextResolved &&
                            storefrontContextValue.configQuery.isError &&
                            !storefrontContextValue.configQuery.isFetching
                        }
                        // Keep the visible identity; each new target gets its own deadline.
                        requestKey={readinessIdentity + navigationTarget}
                        navigationKey={readinessIdentity}
                        pending={Boolean(state.pageDataPending)}
                        navigationPreparing={Boolean(state.isNavigationPending || state.isPreparingProduct)}
                        online={online}
                        language={language}
                        onRetry={() => void state.retryPageLoad()}
                        onNavigationRetry={() => void router.load()}
                        onBack={
                            storefrontContextValue.goBack ??
                            (() => storefrontContextValue.navigate({ name: 'home' }, true))
                        }
                    >
                        <StorefrontPageFrame
                            routeName={renderedRouteName}
                            language={language}
                            desktop={desktop}
                            online={online}
                            previewEmbedded={previewEmbedded}
                            accessMode={state.storefrontAccessMode}
                            storefrontName={storefrontContextValue.storefrontName}
                            logoUrl={storefrontContextValue.logoUrl}
                            displayCurrencyCode={storefrontContextValue.displayCurrencyCode}
                            navigationBlock={navigationBlock}
                            publicMedia={storefrontContextValue.publicMedia}
                            publicMediaScope={
                                storefrontContextValue.storefrontContextResolved
                                    ? JSON.stringify([
                                          storefrontContextValue.market.code,
                                          storefrontContextValue.market.currencyCode,
                                          language,
                                      ])
                                    : undefined
                            }
                            accountLayout={Boolean(customer && isDesktopAccountRoute(displayedRoute.name))}
                            header={
                                desktop && showNavigation ? (
                                    <DesktopHeader
                                        navigationBlock={navigationBlock}
                                        cartQuantity={cart?.totalQuantity ?? 0}
                                    />
                                ) : undefined
                            }
                            accountNavigation={
                                desktop && customer && !authRoute ? <DesktopAccountNavigation /> : undefined
                            }
                            deferred={
                                !previewEmbedded &&
                                deferredUiReady &&
                                shouldShowStorefrontUpdatePrompt(renderedRouteName) ? (
                                    <StorefrontErrorBoundary fallback={null}>
                                        <Suspense fallback={null}>
                                            <StorefrontUpdatePrompt
                                                language={language}
                                                route={renderedRouteName}
                                                initialAssetReferences={initialStorefrontAssetReferences}
                                            />
                                        </Suspense>
                                    </StorefrontErrorBoundary>
                                ) : undefined
                            }
                        >
                            <AuthEmailDraftBoundary
                                active={!customer && authRoute}
                                ownerKey={JSON.stringify([
                                    storefrontContextValue.storefrontCode,
                                    storefrontContextValue.market.code,
                                    storefrontContextValue.market.currencyCode,
                                ])}
                            >
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
                            </AuthEmailDraftBoundary>
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
                        </StorefrontPageFrame>
                        {!desktop &&
                            showNavigation &&
                            shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
                                <BottomNavigation
                                    activeRoute={displayedRoute.name}
                                    cartQuantity={cart?.totalQuantity ?? 0}
                                    language={language}
                                    navigationBlock={navigationBlock}
                                    onNavigate={storefrontContextValue.navigate}
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

                        {/* Keep this host mounted when its dialog closes so focus returns to
                            the original trigger. Language changes retain the in-memory form;
                            store/currency/background changes still release the shared overlay. */}
                        <OverlayHost
                            ownerKey={JSON.stringify([
                                'auth',
                                storefrontContextValue.storefrontCode || storefrontContextValue.market.code,
                                storefrontContextValue.market.code,
                                storefrontContextValue.market.currencyCode,
                                routeHref({ ...displayedRoute, publicLanguage: 'en' }),
                            ])}
                        >
                            {storefrontContextValue.authOverlay && (
                                <Suspense fallback={null}>
                                    <AuthenticationOverlay request={storefrontContextValue.authOverlay} />
                                </Suspense>
                            )}
                        </OverlayHost>

                        {deferredUiReady && (
                            <StorefrontErrorBoundary fallback={null}>
                                <Suspense fallback={null}>
                                    <StorefrontTrafficPreference
                                        api={storefrontContextValue.api}
                                        language={language}
                                    />
                                </Suspense>
                            </StorefrontErrorBoundary>
                        )}
                    </PageReadinessBoundary>
                </OverlayHost>
            </DesktopLayoutContext.Provider>
        </StorefrontContext.Provider>
    );
}

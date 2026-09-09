import { Outlet, lazyRouteComponent } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense } from 'react';

import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import { type useStorefrontAppState } from './hooks/useStorefrontAppState';
import { RouteTransitionLoader } from './route-loading';
import { isPublicStorefrontRoute } from './storefront-access';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';

const LoginRoutePage = lazyRouteComponent(() => import('./route-pages/auth-route-pages'), 'LoginRoutePage');

type StorefrontShellProps = { state: ReturnType<typeof useStorefrontAppState> };

export function StorefrontShell({ state }: StorefrontShellProps) {
    const {
        storefrontContextValue,
        online,
        isZh,
        displayedRoute,
        navigationBlock,
        cart,
        toast,
        language,
        logoUrl,
        storefrontName,
        customer,
        customerLoadState,
        customerLoadError,
        retryAccount,
    } = state;
    const protectedRoute = !isPublicStorefrontRoute(displayedRoute.name);
    const waitingForAccount = !customer && customerLoadState !== 'ready';
    const accountFailed = customerLoadState === 'error' || customerLoadState === 'paused';

    return (
        <StorefrontContext.Provider value={storefrontContextValue}>
            <div className={`storefront-app${online ? '' : ' is-offline'}`}>
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
                <div>
                    <div id="storefront-content">
                        <Suspense
                            fallback={
                                <RouteTransitionLoader
                                    language={language}
                                    logoUrl={logoUrl}
                                    storefrontName={storefrontName}
                                />
                            }
                        >
                            {protectedRoute && waitingForAccount ? (
                                accountFailed ? (
                                    <div role="alert" className="empty-state">
                                        <p>{customerLoadError}</p>
                                        <button type="button" onClick={() => void retryAccount()}>
                                            {isZh ? '重试' : 'Try again'}
                                        </button>
                                        <a href="/promo">{isZh ? '返回介绍页' : 'Back to introduction'}</a>
                                    </div>
                                ) : (
                                    <RouteTransitionLoader
                                        language={language}
                                        logoUrl={logoUrl}
                                        storefrontName={storefrontName}
                                    />
                                )
                            ) : protectedRoute && !customer ? (
                                <LoginRoutePage />
                            ) : (
                                <Outlet />
                            )}
                        </Suspense>
                    </div>
                </div>
            </div>
            {customer && shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
                <BottomNavigation
                    activeRoute={displayedRoute.name}
                    cartQuantity={cart?.totalQuantity ?? 0}
                    language={language}
                    navigationBlock={navigationBlock}
                />
            )}
            {toast && (
                <div className="toast" role="status" aria-live="polite">
                    {toast}
                </div>
            )}
            <StorefrontUpdatePrompt language={language} />
        </StorefrontContext.Provider>
    );
}

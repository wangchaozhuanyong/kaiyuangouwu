import { Outlet } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense } from 'react';

import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import {
    DesktopAccountNavigation,
    isDesktopAccountRoute,
} from './components/common/desktop-account-navigation';
import { DesktopHeader } from './components/common/desktop-header';
import { DesktopLayoutContext, useDesktopViewport } from './desktop-layout';
import { type useStorefrontAppState } from './hooks/useStorefrontAppState';
import { RouteTransitionLoader } from './route-loading';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';

type StorefrontShellProps = { state: ReturnType<typeof useStorefrontAppState> };

export function StorefrontShell({ state }: StorefrontShellProps) {
    const desktop = useDesktopViewport();
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
    } = state;

    return (
        <StorefrontContext.Provider value={storefrontContextValue}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div
                    data-route={displayedRoute.name}
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
                    {desktop && (
                        <DesktopHeader
                            navigationBlock={navigationBlock}
                            cartQuantity={cart?.totalQuantity ?? 0}
                        />
                    )}
                    <div
                        className={
                            desktop && isDesktopAccountRoute(displayedRoute.name)
                                ? 'desktop-account-layout'
                                : undefined
                        }
                    >
                        {desktop && <DesktopAccountNavigation />}
                        <div id="storefront-content" tabIndex={-1}>
                            <Suspense
                                fallback={
                                    <RouteTransitionLoader
                                        language={language}
                                        logoUrl={logoUrl}
                                        storefrontName={storefrontName}
                                    />
                                }
                            >
                                <Outlet />
                            </Suspense>
                        </div>
                    </div>
                </div>
                {!desktop && shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
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
            </DesktopLayoutContext.Provider>
        </StorefrontContext.Provider>
    );
}

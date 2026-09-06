import { Outlet } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense } from 'react';
import type { useStorefrontAppState } from './hooks/useStorefrontAppState';

import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import { DesktopAccountNavigation } from './components/common/desktop-account-navigation';
import { DesktopHeader } from './components/common/desktop-header';
import { RouteTransitionLoader } from './route-loading';
import { LegalFooter } from './storefront-ui/page-shell';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';

export function StorefrontShell({
    state,
    desktopCatalog,
}: {
    state: ReturnType<typeof useStorefrontAppState>;
    desktopCatalog: boolean;
}) {
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
        <>
            <div
                className={`storefront-app${online ? '' : ' is-offline'}${desktopCatalog ? ' has-desktop-catalog' : ''}`}
            >
                <a className="skip-link" href="#storefront-content">
                    {isZh ? '跳到主要内容' : 'Skip to content'}
                </a>
                {desktopCatalog && (
                    <DesktopHeader
                        navigationBlock={navigationBlock}
                        cartQuantity={cart?.totalQuantity ?? 0}
                    />
                )}
                {!online && (
                    <div className="network-banner" role="status">
                        <WifiOff aria-hidden="true" />
                        {isZh
                            ? '当前网络不可用，部分操作可能失败'
                            : 'You are offline. Some actions may fail.'}
                    </div>
                )}
                <div className={desktopCatalog ? 'desktop-store-layout' : undefined}>
                    <div
                        id="storefront-content"
                        className={desktopCatalog ? 'desktop-page-content' : undefined}
                    >
                        {desktopCatalog && <DesktopAccountNavigation />}
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
                        {desktopCatalog && ['services', 'orders'].includes(displayedRoute.name) && (
                            <LegalFooter
                                storefrontName={storefrontName}
                                language={language}
                                onContentTarget={storefrontContextValue.openContentTarget}
                            />
                        )}
                    </div>
                </div>
            </div>
            {!desktopCatalog && shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
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
        </>
    );
}

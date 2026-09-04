import { Outlet } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense } from 'react';

import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { RouteTransitionLoader } from './route-loading';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

export function App() {
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
    } = useStorefrontAppState();

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
                        <Outlet />
                    </Suspense>
                </div>
            </div>
            {shouldShowBottomNavigation(displayedRoute.name, navigationBlock) && (
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

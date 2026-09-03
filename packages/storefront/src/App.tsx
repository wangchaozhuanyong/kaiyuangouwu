import { Outlet } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense } from 'react';
import { BottomNavigation, shouldShowBottomNavigation } from './components/common/bottom-navigation';
import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { RoutePageSkeleton } from './route-loading';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontUpdatePrompt } from './StorefrontUpdatePrompt';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

export function App() {
    const {
        storefrontContextValue,
        online,
        isZh,
        showGlobalProgress,
        text,
        routerLocation,
        displayedRoute,
        navigationBlock,
        cart,
        toast,
        language,
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
                {showGlobalProgress && (
                    <div className="navigation-progress" role="progressbar" aria-label={text.loading} />
                )}
                <div id="storefront-content">
                    <Suspense
                        fallback={
                            <RoutePageSkeleton pathname={routerLocation.pathname} language={language} />
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

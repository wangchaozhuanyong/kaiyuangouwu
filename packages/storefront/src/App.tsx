import { DesktopLayoutContext, useDesktopCatalog } from './desktop-layout';
import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { StorefrontShell } from './storefront-shell';
import { StorefrontContext } from './StorefrontContext';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

export function App() {
    const state = useStorefrontAppState();
    const desktopCatalog = useDesktopCatalog(state.storefrontContextValue.desktopLayout);
    return (
        <DesktopLayoutContext.Provider value={desktopCatalog}>
            <StorefrontContext.Provider value={state.storefrontContextValue}>
                <StorefrontShell state={state} desktopCatalog={desktopCatalog} />
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}

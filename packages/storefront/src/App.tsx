import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { StorefrontDesignPreview } from './storefront-design-preview';
import { StorefrontShell } from './StorefrontShell';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

export function App() {
    if (window.location.pathname === '/__storefront-preview') return <StorefrontDesignPreview />;
    return <StorefrontRuntime />;
}

function StorefrontRuntime() {
    const state = useStorefrontAppState();
    return <StorefrontShell state={state} />;
}

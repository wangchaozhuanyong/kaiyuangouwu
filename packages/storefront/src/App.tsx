import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { StorefrontShell } from './StorefrontShell';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

export function App() {
    const state = useStorefrontAppState();
    return <StorefrontShell state={state} />;
}

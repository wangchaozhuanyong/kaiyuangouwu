import { lazyRouteComponent } from '@tanstack/react-router';
import { Suspense } from 'react';

import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { useStorefrontScrollContinuity } from './hooks/useStorefrontScrollContinuity';
import { PageSkeleton } from './route-loading';
import { StorefrontShell } from './StorefrontShell';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

const Feedback = lazyRouteComponent(() => import('./Feedback'), 'Feedback');
const StorefrontDesignPreview = lazyRouteComponent(
    () => import('./storefront-design-preview'),
    'StorefrontDesignPreview',
);

export function App() {
    if (window.location.pathname === '/__storefront-preview')
        return (
            <Suspense fallback={<PageSkeleton />}>
                <StorefrontDesignPreview />
            </Suspense>
        );
    return <StorefrontRuntime />;
}

function StorefrontRuntime() {
    useStorefrontScrollContinuity();
    const state = useStorefrontAppState();
    return (
        <>
            <StorefrontShell state={state} />
            {!state.storefrontUnavailable && (
                <Suspense fallback={null}>
                    <Feedback runtime={state.storefrontContextValue} />
                </Suspense>
            )}
        </>
    );
}

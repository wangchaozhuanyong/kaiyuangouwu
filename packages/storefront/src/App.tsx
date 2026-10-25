import { lazyRouteComponent } from '@tanstack/react-router';
import { Profiler, Suspense } from 'react';

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
    const runtime = <StorefrontRuntime />;
    if (import.meta.env.DEV)
        return (
            <Profiler
                id="storefront-runtime"
                onRender={(_id, phase, actualDuration) => {
                    if (typeof performance.measure !== 'function') return;
                    if (performance.getEntriesByName('storefront-runtime-commit').length >= 512)
                        performance.clearMeasures('storefront-runtime-commit');
                    performance.measure('storefront-runtime-commit', {
                        start: Math.max(0, performance.now() - actualDuration),
                        detail: { phase, actualDuration },
                    });
                }}
            >
                {runtime}
            </Profiler>
        );
    return runtime;
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

import type { ReactNode } from 'react';

import { cartResolvedRoutes, customerResolvedRoutes, RouteName } from '../storefront-router';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';
import { useStorefront, type StorefrontContextValue } from '../StorefrontContext';

export type RouteRuntime = StorefrontContextValue;

interface PreloadableComponent {
    preload?: () => Promise<void> | undefined;
}

export function registerRoutePreload(routeComponent: object, pageComponent: PreloadableComponent) {
    const preload = () => pageComponent.preload?.() ?? Promise.resolve();
    Object.assign(routeComponent, { preload });
    return preload;
}

export function useRouteRuntime(): RouteRuntime {
    return useStorefront();
}

export function RouteGate({ name, children }: { name: RouteName; children: ReactNode }) {
    const runtime = useRouteRuntime();
    if (customerResolvedRoutes.includes(name) && runtime.customerLoadState !== 'ready') {
        return (
            <AsyncRouteStatePage
                routeName={name}
                state={runtime.customerLoadState}
                error={runtime.customerLoadError}
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.customerQuery.refetch()}
            />
        );
    }
    if (cartResolvedRoutes.includes(name) && runtime.cartLoadState !== 'ready') {
        return (
            <AsyncRouteStatePage
                routeName={name}
                state={runtime.cartLoadState}
                error={runtime.cartQueryError ?? ''}
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.cartQuery.refetch()}
            />
        );
    }
    if ((name === 'purchase' || name === 'checkout') && runtime.publicLoadState !== 'ready') {
        return (
            <AsyncRouteStatePage
                routeName={name}
                state={runtime.publicLoadState}
                error={runtime.error ?? ''}
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.refetchStorefront()}
            />
        );
    }
    return children;
}

import { ReactNode } from 'react';

import { cartResolvedRoutes, customerResolvedRoutes, RouteName } from '../storefront-router';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';
import { StorefrontContext, useStorefront } from '../StorefrontContext';

export type RouteRuntime = Record<string, any>;

export function useRouteRuntime(): RouteRuntime {
    return useStorefront<RouteRuntime>();
}

export function RoutePageContext({ value, children }: { value: RouteRuntime; children: ReactNode }) {
    return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
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
                error={runtime.cartQueryError}
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
                error={runtime.error}
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.refetchStorefront()}
            />
        );
    }
    return children;
}

import type { useNavigate, useRouter } from '@tanstack/react-router';

import { readAuthOverlay, type AuthOverlayRequest } from './auth-overlay-navigation';
import { preloadStorefrontRouteComponent } from './route-component-preload';
import { isCheckoutRoute, routeHref, type RouteState } from './storefront-router';

export function withoutAuthOverlay(search: Record<string, unknown>): Record<string, unknown> {
    const { auth: _auth, authTarget: _target, ...background } = search;
    return background;
}

export function withAuthOverlay(search: Record<string, unknown>, request: AuthOverlayRequest) {
    return {
        ...withoutAuthOverlay(search),
        auth: request.mode,
        ...(request.target ? { authTarget: routeHref(request.target) } : {}),
    };
}

export function authOverlayLoginRoute(request: AuthOverlayRequest): RouteState {
    const target = request.target;
    return target && isCheckoutRoute(target.name)
        ? { name: 'login', returnTo: target.name, id: target.id, quantity: target.quantity }
        : { name: 'login' };
}

/** Loaded only for an explicit authentication action; query rendering stays synchronous. */
export function applyAuthOverlayNavigation(
    router: ReturnType<typeof useRouter>,
    navigate: ReturnType<typeof useNavigate>,
    request: AuthOverlayRequest | null,
    replace = false,
) {
    const location = router.state.location;
    const existing = readAuthOverlay(location.search);
    if (request) {
        void preloadStorefrontRouteComponent(request.mode);
        void navigate({
            to: location.pathname,
            search: withAuthOverlay(location.search, {
                ...request,
                target: request.target ?? existing?.target,
            }),
            replace: Boolean(existing) || replace,
            resetScroll: false,
            state: (previous: Record<string, unknown>) => ({
                ...previous,
                storefrontAuthPushed: existing ? previous.storefrontAuthPushed : !replace,
            }),
        } as never);
        return;
    }
    if (!existing) return;
    const state = location.state as unknown as Record<string, unknown>;
    if (state?.storefrontAuthPushed && router.history.canGoBack()) {
        router.history.back();
    } else {
        void navigate({
            to: location.pathname,
            search: withoutAuthOverlay(location.search),
            replace: true,
            resetScroll: false,
        } as never);
    }
}

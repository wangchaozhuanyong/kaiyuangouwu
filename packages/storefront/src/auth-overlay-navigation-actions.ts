import type { useNavigate, useRouter } from '@tanstack/react-router';

import { readAuthOverlay, type AuthOverlayRequest } from './auth-overlay-navigation';
import { routeHref, routeNavigateOptions, type RouteState } from './storefront-router';

export function prepareAuthOverlay(): void {
    void import('./auth-overlay-preload').then(module => module.preloadAuthOverlay()).catch(() => undefined);
}

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

/** Commit the dialog request immediately; its code prepares in parallel. */
export function applyAuthOverlayNavigation(
    router: ReturnType<typeof useRouter>,
    navigate: ReturnType<typeof useNavigate>,
    request: AuthOverlayRequest | null,
    replace = false,
    background?: RouteState,
) {
    const location = router.state.location;
    const existing = readAuthOverlay(location.search);
    if (request) {
        prepareAuthOverlay();
        const options = background
            ? routeNavigateOptions(background)
            : { to: location.pathname, search: location.search };
        void navigate({
            ...options,
            search: withAuthOverlay(options.search, {
                ...request,
                target: request.target ?? existing?.target,
            }),
            replace: Boolean(existing) || replace,
            resetScroll: false,
            state: (previous: Record<string, unknown>) => ({
                ...previous,
                // An explicit background replaces a locale or an abandoned target;
                // closing must stay on that background rather than revisit the old target.
                storefrontAuthPushed: background
                    ? false
                    : existing
                      ? previous.storefrontAuthPushed
                      : !replace,
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

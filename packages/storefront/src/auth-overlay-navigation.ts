import { isPublicStorefrontRoute } from './storefront-access';
import { routeFromHash, type RouteState } from './storefront-router';

export type AuthOverlayMode = 'login' | 'register' | 'forgot-password';
export interface AuthOverlayRequest {
    mode: AuthOverlayMode;
    target?: RouteState;
}

export function isAuthOverlayMode(value: unknown): value is AuthOverlayMode {
    return value === 'login' || value === 'register' || value === 'forgot-password';
}

export function readAuthOverlay(search: Record<string, unknown>): AuthOverlayRequest | null {
    if (!isAuthOverlayMode(search.auth)) return null;
    const value = search.authTarget;
    let target: RouteState | undefined;
    // Only known local protected destinations can resume after authentication.
    if (
        typeof value === 'string' &&
        value.startsWith('/') &&
        !value.startsWith('//') &&
        !value.includes('\\')
    ) {
        const candidate = routeFromHash(`#${value}`);
        if (!isPublicStorefrontRoute(candidate.name)) target = candidate;
    }
    return { mode: search.auth, target };
}

export function authOverlayForNavigation(
    next: RouteState,
    authenticated: boolean,
): AuthOverlayRequest | null {
    if (isAuthOverlayMode(next.name)) {
        return {
            mode: next.name,
            target: next.returnTo ? { name: next.returnTo, id: next.id, quantity: next.quantity } : undefined,
        };
    }
    return !authenticated && !isPublicStorefrontRoute(next.name) ? { mode: 'login', target: next } : null;
}

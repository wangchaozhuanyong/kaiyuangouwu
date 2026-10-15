import type { AnyRouter, RouterHistory } from '@tanstack/react-router';

import { routeFromRouterLocation, routePageIdentity } from './storefront-router';

/** Move keyboard reading order only after a different page has actually committed. */
export function trackStorefrontRouteFocus(
    router: Pick<AnyRouter, 'subscribe' | 'state'> & { history: RouterHistory },
): () => void {
    let pending: { href: string; source: Element | null; page: string } | undefined;
    let action = 'REPLACE';
    let frame: number | undefined;
    const cancel = () => {
        pending = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
    };
    const unhistory = router.history.subscribe(event => {
        action = event.action.type;
    });
    const before = router.subscribe('onBeforeNavigate', event => {
        cancel();
        if (!event.fromLocation) return;
        const from = routeFromRouterLocation(event.fromLocation.pathname, event.fromLocation.search);
        const to = routeFromRouterLocation(event.toLocation.pathname, event.toLocation.search);
        if (routePageIdentity(from) === routePageIdentity(to)) return;
        pending = { href: event.toLocation.href, source: document.activeElement, page: to.name };
    });
    const rendered = router.subscribe('onRendered', event => {
        const navigation = pending;
        if (!navigation || navigation.href !== event.toLocation.href) return;
        frame = requestAnimationFrame(() => {
            frame = undefined;
            if (pending !== navigation || router.state.location.href !== navigation.href) return;
            pending = undefined;
            // Native back/forward owns its existing focus/scroll context.
            if (!['PUSH', 'REPLACE'].includes(action)) return;
            const active = document.activeElement;
            if (active !== document.body && active !== navigation.source && active?.isConnected) return;
            if (
                document.querySelector(
                    '[role="dialog"][aria-modal="true"]:not([hidden]):not([aria-hidden="true"]), dialog[open]',
                )
            )
                return;
            const content = document.querySelector<HTMLElement>(
                `[data-route="${navigation.page}"] #storefront-content`,
            );
            if (!content || content.closest('[hidden], [inert]')) return;
            const target =
                Array.from(content.querySelectorAll<HTMLElement>('h1')).find(
                    heading => heading.getClientRects().length > 0 && !heading.closest('[hidden], [inert]'),
                ) ?? content;
            if (target.closest('[hidden], [inert]')) return;
            const temporary = !target.hasAttribute('tabindex');
            if (temporary) target.tabIndex = -1;
            target.focus({ preventScroll: true });
            if (temporary)
                target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        });
    });
    return () => {
        cancel();
        unhistory();
        before();
        rendered();
    };
}

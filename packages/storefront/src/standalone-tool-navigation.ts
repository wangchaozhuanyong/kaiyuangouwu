import type { MouseEvent, SyntheticEvent } from 'react';
import { preconnect } from 'react-dom';

import { shouldPrefetchMedia } from './hooks/useOnlineStatus';

/** Prepare only the connection on intent; never open the tool or read customer data. */
export function warmStandaloneTool(event: SyntheticEvent<HTMLAnchorElement>) {
    if (document.hidden || navigator.onLine === false || !shouldPrefetchMedia()) return;
    preconnect(event.currentTarget.origin);
}

/** Copied links/new tabs stay independent; only a same-tab click requests browser back. */
export function openStandaloneTool(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const link = document.createElement('a');
    link.href = event.currentTarget.href + '#back';
    link.referrerPolicy = 'no-referrer';
    link.click();
}

export function standaloneToolNavigation(goBack: () => void) {
    const location = new URL(window.location.href);
    if (location.hash === '#back') {
        // A history-entry flag survives refresh, but never records the referring site URL.
        history.replaceState(
            { fromPreviousPage: history.length > 1 },
            '',
            location.pathname + location.search,
        );
    }
    return {
        language: location.searchParams.get('lang') === 'en' ? ('en' as const) : ('zh' as const),
        onBack: history.state?.fromPreviousPage === true && history.length > 1 ? goBack : undefined,
    };
}

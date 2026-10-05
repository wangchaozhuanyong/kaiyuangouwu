import { useSyncExternalStore } from 'react';

const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';
const subscribe = (onChange: () => void) => {
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
};
const snapshot = () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches;

/** Viewport presentation state only; never owns business data or page lifecycle. */
export function useMobileLayout() {
    return useSyncExternalStore(subscribe, snapshot, () => false);
}

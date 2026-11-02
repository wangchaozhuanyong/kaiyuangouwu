import { useSyncExternalStore } from 'react';

import { useOnlineStatus } from './useOnlineStatus';

const visibleSnapshot = () => document.visibilityState !== 'hidden';
const serverSnapshot = () => true;
function subscribe(notify: () => void) {
    document.addEventListener('visibilitychange', notify);
    return () => document.removeEventListener('visibilitychange', notify);
}

/** Optional business work shares connection state and pauses while its document is hidden. */
export function useStorefrontPageActivity() {
    const online = useOnlineStatus();
    const visible = useSyncExternalStore(subscribe, visibleSnapshot, serverSnapshot);
    return online && visible;
}

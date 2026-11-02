import { useSyncExternalStore } from 'react';

function subscribeToConnection(notify: () => void) {
    addEventListener('online', notify);
    addEventListener('offline', notify);
    return () => {
        removeEventListener('online', notify);
        removeEventListener('offline', notify);
    };
}

const connectionSnapshot = () => navigator.onLine !== false;
// Public HTML cannot know browser connectivity. Adopt that same first tree,
// then synchronize the real connection state without replacing its content.

export function useOnlineStatus() {
    return useSyncExternalStore(subscribeToConnection, connectionSnapshot, () => true);
}

export function shouldPrefetchMedia(): boolean {
    if (typeof window === 'undefined') return false;
    const connection = (
        navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    return !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType ?? '');
}

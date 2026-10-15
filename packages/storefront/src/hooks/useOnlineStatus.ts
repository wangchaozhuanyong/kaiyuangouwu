import { useSyncExternalStore } from 'react';

function subscribeToConnection(notify: () => void) {
    window.addEventListener('online', notify);
    window.addEventListener('offline', notify);
    return () => {
        window.removeEventListener('online', notify);
        window.removeEventListener('offline', notify);
    };
}

const connectionSnapshot = () => navigator.onLine !== false;
// Public HTML cannot know browser connectivity. Adopt that same first tree,
// then synchronize the real connection state without replacing its content.
const serverConnectionSnapshot = () => true;

export function useOnlineStatus() {
    return useSyncExternalStore(subscribeToConnection, connectionSnapshot, serverConnectionSnapshot);
}

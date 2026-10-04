import { useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { TabPageContext } from '../layouts/tab-page-context';

const subscribe = (listener: () => void) => {
    document.addEventListener('visibilitychange', listener);
    window.addEventListener('online', listener);
    window.addEventListener('offline', listener);
    return () => {
        document.removeEventListener('visibilitychange', listener);
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
    };
};
const snapshot = () => document.visibilityState !== 'hidden' && navigator.onLine;
export function usePageActivity() {
    const tab = useContext(TabPageContext);
    const available = useSyncExternalStore(subscribe, snapshot, () => true);
    return (tab?.active ?? true) && available;
}

/** All periodic page work shares visibility, connectivity and cleanup rules. */
export function useActiveInterval(callback: () => void, interval: number) {
    const active = usePageActivity();
    const current = useRef(callback);
    useLayoutEffect(() => {
        current.current = callback;
    }, [callback]);
    useEffect(() => {
        if (!active || !interval) return;
        const timer = window.setInterval(() => current.current(), interval);
        return () => window.clearInterval(timer);
    }, [active, interval]);
}

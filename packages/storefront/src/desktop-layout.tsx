import { createContext, useContext, useSyncExternalStore } from 'react';

export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);

const desktopQuery = '(min-width: 1024px)';
function subscribeToViewport(onChange: () => void) {
    const query = window.matchMedia(desktopQuery);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function useDesktopViewport() {
    return useSyncExternalStore(
        subscribeToViewport,
        () => window.matchMedia(desktopQuery).matches,
        () => false,
    );
}

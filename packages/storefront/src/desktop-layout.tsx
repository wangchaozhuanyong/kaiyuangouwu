import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);

const desktopQuery = '(min-width: 1024px)';
export function viewportMatches(mediaQuery = desktopQuery) {
    return typeof window !== 'undefined' && window.matchMedia?.(mediaQuery).matches === true;
}

export function useDesktopViewport(mediaQuery = desktopQuery) {
    const subscribeToViewport = useCallback(
        (onChange: () => void) => {
            const query = window.matchMedia(mediaQuery);
            query.addEventListener('change', onChange);
            return () => query.removeEventListener('change', onChange);
        },
        [mediaQuery],
    );
    return useSyncExternalStore(
        subscribeToViewport,
        () => viewportMatches(mediaQuery),
        () => false,
    );
}

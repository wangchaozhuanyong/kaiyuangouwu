import { createContext, useContext, useSyncExternalStore } from 'react';

export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);

const desktopQuery = '(min-width: 1024px)';

function subscribeToDesktopLayout(onChange: () => void) {
    const query = window.matchMedia(desktopQuery);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function supportsDesktopCatalog(layout: unknown): boolean {
    return layout === 'catalog';
}

export function useDesktopCatalog(layout: unknown): boolean {
    const desktop = useSyncExternalStore(
        subscribeToDesktopLayout,
        () => window.matchMedia(desktopQuery).matches,
        () => false,
    );
    return desktop && supportsDesktopCatalog(layout);
}

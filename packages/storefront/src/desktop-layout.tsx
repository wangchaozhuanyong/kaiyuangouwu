import { createContext, useContext, useSyncExternalStore } from 'react';

export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);

const desktopQuery = '(min-width: 1024px)';

function subscribeToDesktopLayout(onChange: () => void) {
    const query = window.matchMedia(desktopQuery);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function supportsDesktopCatalog(storefrontCode: string): boolean {
    // The default Channel owns MOYAO's catalog layout. Other storefronts keep their own presentation.
    return storefrontCode === '__default_channel__';
}

export function useDesktopCatalog(storefrontCode: string): boolean {
    const desktop = useSyncExternalStore(
        subscribeToDesktopLayout,
        () => window.matchMedia(desktopQuery).matches,
        () => false,
    );
    return desktop && supportsDesktopCatalog(storefrontCode);
}

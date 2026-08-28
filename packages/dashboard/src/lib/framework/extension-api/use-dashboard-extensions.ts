import { useEffect, useState } from 'react';
import { runDashboardExtensions } from 'virtual:dashboard-extensions';

import { onExtensionSourceChange } from './define-dashboard-extension.js';

let dashboardExtensionsPromise: Promise<void> | undefined;

function loadDashboardExtensionsOnce(): Promise<void> {
    dashboardExtensionsPromise ??= runDashboardExtensions();
    return dashboardExtensionsPromise;
}

/**
 * @description
 * This hook is used to load dashboard extensions via the `virtual:dashboard-extensions` module,
 * which is provided by the `vite-plugin-dashboard-metadata` plugin.
 *
 * It should be used in any component whose rendering depends on the content of the dashboard extensions.
 */
export function useDashboardExtensions() {
    const [extensionsLoaded, setExtensionsLoaded] = useState(false);
    const [extensionLoadError, setExtensionLoadError] = useState<Error | null>(null);
    const [reloadCount, setReloadCount] = useState(0);

    useEffect(() => {
        let mounted = true;
        void loadDashboardExtensionsOnce().then(
            () => {
                if (mounted) setExtensionsLoaded(true);
            },
            error => {
                if (mounted) {
                    setExtensionLoadError(
                        error instanceof Error ? error : new Error('Unknown dashboard extension error'),
                    );
                }
            },
        );
        const unsubscribe = onExtensionSourceChange(() => {
            // Setting this state var is only really done
            // in order to force a re-render of components using this hook.
            // This allows components to react to HMR events during development.
            setReloadCount(old => old + 1);
        });
        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);
    return { extensionsLoaded, extensionLoadError, reloadCount };
}

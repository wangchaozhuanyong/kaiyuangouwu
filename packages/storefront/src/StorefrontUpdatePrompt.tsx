import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    STOREFRONT_VERSION_CHECK_INTERVAL_MS,
    currentStorefrontAssetFingerprint,
    fetchStorefrontAssetFingerprint,
} from './storefront-version';

export function StorefrontUpdatePrompt() {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        if (!import.meta.env.PROD) return;
        const currentFingerprint = currentStorefrontAssetFingerprint();
        if (!currentFingerprint) return;

        let disposed = false;
        let checking = false;
        let updateFound = false;

        const checkForUpdate = async () => {
            if (disposed || checking || updateFound || !navigator.onLine) return;
            checking = true;
            try {
                const latestFingerprint = await fetchStorefrontAssetFingerprint();
                if (!disposed && latestFingerprint && latestFingerprint !== currentFingerprint) {
                    updateFound = true;
                    setUpdateAvailable(true);
                }
            } catch {
                // A failed background check must not interrupt the storefront.
            } finally {
                checking = false;
            }
        };
        const checkVisiblePage = () => {
            if (document.visibilityState === 'visible') void checkForUpdate();
        };
        const interval = window.setInterval(checkVisiblePage, STOREFRONT_VERSION_CHECK_INTERVAL_MS);

        window.addEventListener('focus', checkVisiblePage);
        window.addEventListener('online', checkVisiblePage);
        document.addEventListener('visibilitychange', checkVisiblePage);
        void checkForUpdate();

        return () => {
            disposed = true;
            window.clearInterval(interval);
            window.removeEventListener('focus', checkVisiblePage);
            window.removeEventListener('online', checkVisiblePage);
            document.removeEventListener('visibilitychange', checkVisiblePage);
        };
    }, []);

    if (!updateAvailable) return null;

    return (
        <aside className="storefront-update-prompt" role="status" aria-live="polite">
            <div>
                <strong>前台已有新版本</strong>
                <span>New version available</span>
            </div>
            <button type="button" onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden="true" />
                立即刷新
            </button>
        </aside>
    );
}

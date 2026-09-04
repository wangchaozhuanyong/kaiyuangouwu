import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StorefrontLanguage } from './types';

import {
    STOREFRONT_VERSION_CHECK_INTERVAL_MS,
    currentStorefrontAssetFingerprint,
    fetchStorefrontAssetFingerprint,
} from './storefront-version';

// Capture the entry assets while this eagerly-loaded module is evaluated. Route-level
// styles can be attached before React effects run and are not part of the build identity.
const initialStorefrontAssetFingerprint =
    typeof document === 'undefined' ? null : currentStorefrontAssetFingerprint();

const storefrontUpdateCopy = {
    zh: {
        title: '发现新版本',
        description: '刷新即可使用最新内容',
        action: '立即刷新',
    },
    en: {
        title: 'Update available',
        description: 'Refresh to use the latest version',
        action: 'Refresh now',
    },
} satisfies Record<StorefrontLanguage, { title: string; description: string; action: string }>;

export function getStorefrontUpdateCopy(language: StorefrontLanguage) {
    return storefrontUpdateCopy[language];
}

export function StorefrontUpdatePrompt({ language }: { language: StorefrontLanguage }) {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        if (!import.meta.env.PROD) return;
        const currentFingerprint = initialStorefrontAssetFingerprint ?? currentStorefrontAssetFingerprint();
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
    const copy = getStorefrontUpdateCopy(language);

    return (
        <aside
            className="storefront-update-prompt"
            role="status"
            aria-live="polite"
            aria-labelledby="storefront-update-title"
            aria-describedby="storefront-update-description"
        >
            <div className="storefront-update-copy">
                <strong id="storefront-update-title">{copy.title}</strong>
                <span id="storefront-update-description">{copy.description}</span>
            </div>
            <button type="button" onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden="true" />
                {copy.action}
            </button>
        </aside>
    );
}

// organize-imports-ignore
import type { RouteName } from './storefront-router';
import type { StorefrontLanguage } from './types';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { shouldShowStorefrontUpdatePrompt } from './storefront-deferred-ui';
import {
    STOREFRONT_VERSION_CHECK_INTERVAL_MS,
    currentStorefrontAssetFingerprint,
    fetchStorefrontAssetFingerprint,
    storefrontAssetFingerprint,
} from './storefront-version';

export { shouldShowStorefrontUpdatePrompt } from './storefront-deferred-ui';

// Standalone callers retain their existing capture behavior. The shell passes references
// captured before lazy route styles were attached, even though this module now loads later.
const initialStorefrontAssetFingerprint =
    typeof document === 'undefined' ? null : currentStorefrontAssetFingerprint();

const storefrontUpdateCopy = {
    zh: {
        title: '发现新版本',
        description: '刷新即可使用最新内容',
        action: '立即刷新',
        later: '稍后',
    },
    en: {
        title: 'Update available',
        description: 'Refresh to use the latest version',
        action: 'Refresh now',
        later: 'Later',
    },
} satisfies Record<StorefrontLanguage, { title: string; description: string; action: string; later: string }>;

const REMIND_LATER_MS = 30 * 60 * 1000;

function reminderKey(fingerprint: string): string {
    return `storefront-update-remind-at:${fingerprint}`;
}

function savedReminderTime(fingerprint: string): number {
    try {
        return Number(window.sessionStorage.getItem(reminderKey(fingerprint))) || 0;
    } catch {
        return 0;
    }
}

export function getStorefrontUpdateCopy(language: StorefrontLanguage) {
    return storefrontUpdateCopy[language];
}

export function StorefrontUpdatePrompt({
    language,
    route,
    initialAssetReferences,
}: {
    language: StorefrontLanguage;
    route: RouteName;
    initialAssetReferences?: readonly string[];
}) {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [latestFingerprint, setLatestFingerprint] = useState('');
    const [remindAt, setRemindAt] = useState(0);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!import.meta.env.PROD) return;
        const currentFingerprint = initialAssetReferences
            ? storefrontAssetFingerprint(initialAssetReferences, window.location.href)
            : (initialStorefrontAssetFingerprint ?? currentStorefrontAssetFingerprint());
        if (!currentFingerprint) return;

        let disposed = false;
        let checking = false;
        let updateFound = false;
        let activeCheck: AbortController | undefined;

        const checkForUpdate = async () => {
            if (
                disposed ||
                checking ||
                updateFound ||
                !navigator.onLine ||
                document.readyState !== 'complete'
            )
                return;
            checking = true;
            activeCheck = new AbortController();
            try {
                const fetchedFingerprint = await fetchStorefrontAssetFingerprint({
                    signal: activeCheck.signal,
                });
                if (!disposed && fetchedFingerprint && fetchedFingerprint !== currentFingerprint) {
                    updateFound = true;
                    setLatestFingerprint(fetchedFingerprint);
                    setRemindAt(savedReminderTime(fetchedFingerprint));
                    setUpdateAvailable(true);
                }
            } catch {
                // A failed background check must not interrupt the storefront.
            } finally {
                checking = false;
                activeCheck = undefined;
            }
        };
        const checkVisiblePage = () => {
            if (document.visibilityState === 'visible') void checkForUpdate();
        };
        const interval = window.setInterval(checkVisiblePage, STOREFRONT_VERSION_CHECK_INTERVAL_MS);

        window.addEventListener('focus', checkVisiblePage);
        window.addEventListener('load', checkVisiblePage);
        window.addEventListener('online', checkVisiblePage);
        document.addEventListener('visibilitychange', checkVisiblePage);
        void checkForUpdate();

        return () => {
            disposed = true;
            activeCheck?.abort();
            window.clearInterval(interval);
            window.removeEventListener('focus', checkVisiblePage);
            window.removeEventListener('load', checkVisiblePage);
            window.removeEventListener('online', checkVisiblePage);
            document.removeEventListener('visibilitychange', checkVisiblePage);
        };
    }, [initialAssetReferences]);

    useEffect(() => {
        if (!updateAvailable || remindAt <= now) return;
        const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, remindAt - now));
        return () => window.clearTimeout(timeout);
    }, [updateAvailable, remindAt, now]);

    if (
        !updateAvailable ||
        !latestFingerprint ||
        remindAt > now ||
        !shouldShowStorefrontUpdatePrompt(route)
    ) {
        return null;
    }
    const copy = getStorefrontUpdateCopy(language);

    const remindLater = () => {
        const nextReminder = Date.now() + REMIND_LATER_MS;
        setRemindAt(nextReminder);
        setNow(Date.now());
        try {
            window.sessionStorage.setItem(reminderKey(latestFingerprint), String(nextReminder));
        } catch {
            // Storage may be unavailable; the in-memory reminder still works.
        }
    };

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
            <div className="storefront-update-actions">
                <button className="storefront-update-later" type="button" onClick={remindLater}>
                    {copy.later}
                </button>
                <button type="button" onClick={() => window.location.reload()}>
                    <RefreshCw aria-hidden="true" />
                    {copy.action}
                </button>
            </div>
        </aside>
    );
}

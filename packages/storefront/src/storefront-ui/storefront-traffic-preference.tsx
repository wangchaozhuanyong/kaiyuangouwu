// organize-imports-ignore
import type { ShopApi } from '../api';
import type { StorefrontTrafficConsent } from '../storefront-traffic';
import type { StorefrontLanguage } from '../types';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
    setStorefrontTrafficConsent,
    storefrontTrafficConsent,
    storefrontTrafficConsentId,
    TRAFFIC_PREFERENCE_EVENT,
} from '../storefront-traffic';

import { StorefrontTrafficNotice } from './storefront-traffic-notice';

export function StorefrontTrafficPreference({
    api,
    language,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
}) {
    const [preference, setPreference] = useState<StorefrontTrafficConsent>('unknown');
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    useLayoutEffect(() => {
        setPreference(storefrontTrafficConsent());
    }, []);
    useLayoutEffect(() => {
        document.documentElement.toggleAttribute('data-storefront-traffic-choice', preference !== 'unknown');
    }, [preference]);
    useEffect(() => {
        const refresh = () => setPreference(storefrontTrafficConsent());
        window.addEventListener('storage', refresh);
        window.addEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        return () => {
            window.removeEventListener('storage', refresh);
            window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        };
    }, []);

    const choose = async (granted: boolean) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        if (!granted) {
            try {
                setStorefrontTrafficConsent(false);
            } catch {
                // An unavailable browser store must not block the necessary-only choice.
            }
            setPreference('denied');
        }
        try {
            await api.recordAnalyticsConsent({
                consentId: storefrontTrafficConsentId(),
                granted,
                locale: language,
            });
            setStorefrontTrafficConsent(granted);
            setPreference(granted ? 'granted' : 'denied');
        } catch {
            // A failed grant cannot enable analytics; close the banner in the safe state.
            try {
                setStorefrontTrafficConsent(false);
            } catch {
                // Unknown consent also keeps analytics disabled when storage is unavailable.
            }
            setPreference('denied');
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };

    if (preference === 'unknown') {
        return (
            <StorefrontTrafficNotice
                language={language}
                busy={busy}
                onChoose={granted => void choose(granted)}
            />
        );
    }

    return null;
}

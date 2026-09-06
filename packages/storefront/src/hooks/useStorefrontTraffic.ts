import { useEffect, useRef } from 'react';

import { ShopApi } from '../api';
import { storefrontVisitorId } from '../referral-attribution';
import {
    createStorefrontTrafficTracker,
    shouldTrackStorefrontTraffic,
    storefrontTrafficOptedOut,
    TRAFFIC_PREFERENCE_EVENT,
} from '../storefront-traffic';

export function useStorefrontTraffic(input: {
    api: ShopApi;
    channel: string;
    location: string;
    customerId: string | null;
    enabled: boolean;
}) {
    const tracker = useRef(createStorefrontTrafficTracker());
    const { api, channel, location, customerId, enabled } = input;
    useEffect(() => {
        if (!enabled) return;
        const record = () => {
            if (
                !shouldTrackStorefrontTraffic({
                    hostname: window.location.hostname,
                    pathname: window.location.pathname,
                    visible: document.visibilityState === 'visible',
                    automated: navigator.webdriver,
                    optedOut: storefrontTrafficOptedOut(),
                })
            )
                return;
            const businessDate = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date());
            void tracker.current.track(
                { channel, location, businessDate, customerId },
                storefrontVisitorId(),
                value => api.recordStorefrontPageView(value),
            );
        };
        record();
        document.addEventListener('visibilitychange', record);
        window.addEventListener('online', record);
        window.addEventListener('focus', record);
        window.addEventListener('storage', record);
        window.addEventListener(TRAFFIC_PREFERENCE_EVENT, record);
        return () => {
            document.removeEventListener('visibilitychange', record);
            window.removeEventListener('online', record);
            window.removeEventListener('focus', record);
            window.removeEventListener('storage', record);
            window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, record);
        };
    }, [api, channel, location, customerId, enabled]);
}

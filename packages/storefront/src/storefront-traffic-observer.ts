import type { ShopApi } from './api';

import { storefrontVisitorId } from './referral-attribution';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import {
    createStorefrontTrafficTracker,
    shouldTrackStorefrontTraffic,
    storefrontTrafficOptedOut,
    TRAFFIC_PREFERENCE_EVENT,
} from './storefront-traffic';

export type TrafficObserverInput = {
    api: ShopApi;
    channel: string;
    location: string;
    customerId: string | null;
    enabled: boolean;
};
export type TrafficTracker = ReturnType<typeof createStorefrontTrafficTracker>;
export function observeStorefrontTraffic(
    input: TrafficObserverInput,
    tracker: { current: TrafficTracker | null },
): () => void {
    const { api, channel, location, customerId } = input;
    tracker.current ??= createStorefrontTrafficTracker();
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return () => undefined;
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
        let referrerHost: string | null = null;
        try {
            const referrer = document.referrer ? new URL(document.referrer) : null;
            if (referrer && referrer.hostname !== window.location.hostname) {
                referrerHost = referrer.host;
            }
        } catch {
            referrerHost = null;
        }
        void tracker.current?.track(
            { channel, location, businessDate, customerId, referrerHost },
            storefrontVisitorId(),
            value => api.recordStorefrontPageView(value),
        );
    };
    const pulse = () => {
        if (
            !shouldTrackStorefrontTraffic({
                hostname: window.location.hostname,
                pathname: window.location.pathname,
                visible: document.visibilityState === 'visible',
                automated: navigator.webdriver,
                optedOut: false,
            })
        )
            return;
        const heartbeatVisitorId = storefrontVisitorId();
        if (heartbeatVisitorId)
            void api.contentReviewsApi.recordStorefrontHeartbeat(heartbeatVisitorId).catch(() => undefined);
    };
    pulse();
    const heartbeat = window.setInterval(pulse, 60_000);
    document.addEventListener('visibilitychange', pulse);
    window.addEventListener('online', pulse);
    window.addEventListener(TRAFFIC_PREFERENCE_EVENT, pulse);
    window.addEventListener('storage', pulse);
    record();
    document.addEventListener('visibilitychange', record);
    window.addEventListener('online', record);
    window.addEventListener('focus', record);
    window.addEventListener('storage', record);
    window.addEventListener(TRAFFIC_PREFERENCE_EVENT, record);
    return () => {
        window.clearInterval(heartbeat);
        document.removeEventListener('visibilitychange', pulse);
        window.removeEventListener('online', pulse);
        window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, pulse);
        window.removeEventListener('storage', pulse);
        document.removeEventListener('visibilitychange', record);
        window.removeEventListener('online', record);
        window.removeEventListener('focus', record);
        window.removeEventListener('storage', record);
        window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, record);
    };
}

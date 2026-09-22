export const TRAFFIC_OPT_OUT_KEY = 'storefront-analytics-opt-out:v1';
export const TRAFFIC_CONSENT_ID_KEY = 'storefront-analytics-consent-id:v1';
export const TRAFFIC_PREFERENCE_EVENT = 'storefront-traffic-preference';
const CONSENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type StorefrontTrafficConsent = 'unknown' | 'granted' | 'denied';

export function storefrontTrafficConsent(): StorefrontTrafficConsent {
    if (typeof document === 'undefined') return 'unknown';
    const cookie = document.cookie
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('storefront_analytics_consent='))
        ?.split('=')[1];
    if (cookie === 'granted' || cookie === 'denied') return cookie;
    try {
        const stored = localStorage.getItem(TRAFFIC_OPT_OUT_KEY);
        if (stored === '0') return 'granted';
        if (stored === '1') return 'denied';
    } catch {
        // No persisted choice means analytics stays disabled.
    }
    return 'unknown';
}

export function storefrontTrafficOptedOut(): boolean {
    return storefrontTrafficConsent() !== 'granted';
}

export function setStorefrontTrafficOptOut(excluded: boolean): void {
    setStorefrontTrafficConsent(!excluded);
}

export function setStorefrontTrafficConsent(granted: boolean): void {
    const value = granted ? '0' : '1';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `storefront_analytics_consent=${granted ? 'granted' : 'denied'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.cookie = `storefront_analytics_opt_out=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    try {
        localStorage.setItem(TRAFFIC_OPT_OUT_KEY, value);
    } catch {
        // A same-origin cookie still preserves the preference if local storage is unavailable.
        if (
            !document.cookie.split(';').some(part => part.trim() === `storefront_analytics_opt_out=${value}`)
        ) {
            throw new Error('Unable to save traffic preference');
        }
    }
    window.dispatchEvent(new Event(TRAFFIC_PREFERENCE_EVENT));
}

export function storefrontTrafficConsentId(): string {
    try {
        const stored = localStorage.getItem(TRAFFIC_CONSENT_ID_KEY);
        if (stored && CONSENT_ID_PATTERN.test(stored)) return stored;
        const created = crypto.randomUUID();
        localStorage.setItem(TRAFFIC_CONSENT_ID_KEY, created);
        return created;
    } catch {
        return crypto.randomUUID();
    }
}

export interface StorefrontPageViewInput {
    eventId: string;
    visitorId: string | null;
    pageView: boolean;
    path?: string | null;
    referrerHost?: string | null;
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    term?: string | null;
    content?: string | null;
}

interface TrafficPage {
    channel: string;
    location: string;
    businessDate: string;
    customerId: string | null;
    referrerHost?: string | null;
}

/** One event per displayed route; rerenders and login only identify the existing view. */
export function createStorefrontTrafficTracker(generateId = () => crypto.randomUUID()) {
    let current:
        | {
              page: { key: string; eventId: string; recorded: boolean };
              customerId: string | null;
              pending: boolean;
              acknowledged: boolean;
          }
        | undefined;
    let queue = Promise.resolve();
    return {
        track(
            page: TrafficPage,
            visitorId: string | null,
            send: (input: StorefrontPageViewInput) => Promise<boolean>,
        ): Promise<void> {
            const key = JSON.stringify([page.channel, page.location, page.businessDate]);
            const previous = current?.page.key === key ? current : undefined;
            if (previous?.customerId === page.customerId && (previous.pending || previous.acknowledged))
                return queue;
            const operation = {
                page: previous?.page ?? { key, eventId: generateId(), recorded: false },
                customerId: page.customerId,
                pending: true,
                acknowledged: false,
            };
            current = operation;
            // Serialize identity changes behind the original view. Retries retain the event ID.
            queue = queue.then(async () => {
                const input = {
                    eventId: operation.page.eventId,
                    visitorId,
                    pageView: !operation.page.recorded,
                    ...storefrontAttributionInput(page.location, page.referrerHost),
                };
                try {
                    operation.acknowledged = await send(input);
                } catch {
                    try {
                        operation.acknowledged = await send(input);
                    } catch {
                        // A lost response may already be committed. Keep its ID for the next attempt.
                        operation.acknowledged = false;
                    }
                }
                if (operation.acknowledged) operation.page.recorded = true;
                operation.pending = false;
            });
            return queue;
        },
    };
}

export function storefrontAttributionInput(location: string, referrerHost?: string | null) {
    const parsed = new URL(location, 'https://storefront.invalid');
    const parameter = (name: string) => parsed.searchParams.get(name)?.trim() || null;
    const googleClick = parameter('gclid');
    const metaClick = parameter('fbclid');
    return {
        path: parsed.pathname,
        referrerHost:
            referrerHost
                ?.trim()
                .toLowerCase()
                .replace(/^www\./u, '') || null,
        source: parameter('utm_source') ?? (googleClick ? 'google' : metaClick ? 'facebook' : null),
        medium: parameter('utm_medium') ?? (googleClick || metaClick ? 'cpc' : null),
        campaign: parameter('utm_campaign'),
        term: parameter('utm_term'),
        content: parameter('utm_content'),
    };
}

export function shouldTrackStorefrontTraffic(input: {
    hostname: string;
    pathname: string;
    visible: boolean;
    automated: boolean;
    optedOut: boolean;
}): boolean {
    return (
        input.visible &&
        !input.automated &&
        !input.optedOut &&
        !/^(localhost|127(?:\.\d+){3}|\[?::1\]?)$/iu.test(input.hostname) &&
        !/^\/(dashboard|admin-api|shop-api|health)(\/|$)/u.test(input.pathname)
    );
}

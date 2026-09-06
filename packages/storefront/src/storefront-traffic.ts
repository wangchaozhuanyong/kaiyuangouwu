export const TRAFFIC_OPT_OUT_KEY = 'storefront-analytics-opt-out:v1';
export const TRAFFIC_PREFERENCE_EVENT = 'storefront-traffic-preference';

export function storefrontTrafficOptedOut(): boolean {
    if (typeof document === 'undefined') return false;
    const cookie = document.cookie.split(';').some(part => part.trim() === 'storefront_analytics_opt_out=1');
    try {
        return cookie || localStorage.getItem(TRAFFIC_OPT_OUT_KEY) === '1';
    } catch {
        return cookie;
    }
}

export function setStorefrontTrafficOptOut(excluded: boolean): void {
    const value = excluded ? '1' : '0';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
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

export interface StorefrontPageViewInput {
    eventId: string;
    visitorId: string | null;
    pageView: boolean;
}

interface TrafficPage {
    channel: string;
    location: string;
    businessDate: string;
    customerId: string | null;
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

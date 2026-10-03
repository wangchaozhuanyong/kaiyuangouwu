import type { TrafficObserverInput, TrafficTracker } from '../storefront-traffic-observer';
import { useEffect, useRef } from 'react';

export function useStorefrontTraffic(input: TrafficObserverInput) {
    const tracker = useRef<TrafficTracker | null>(null);
    const { api, channel, location, customerId, enabled } = input;
    useEffect(() => {
        if (!enabled) return;
        let active = true;
        let cleanup: (() => void) | undefined;
        void import('../storefront-traffic-observer')
            .then(({ observeStorefrontTraffic }) => {
                if (active)
                    cleanup = observeStorefrontTraffic(
                        { api, channel, location, customerId, enabled },
                        tracker,
                    );
            })
            .catch(() => undefined);
        return () => {
            active = false;
            cleanup?.();
        };
    }, [api, channel, location, customerId, enabled]);
}

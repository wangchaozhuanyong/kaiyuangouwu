import { useCallback, useSyncExternalStore } from 'react';

import { type useCustomerLogout } from './hooks/useCustomerLogout';
import { type RouteRuntime } from './route-pages/shared';

type Controller = ReturnType<typeof useCustomerLogout> & { scope: string };
let controller: Controller | undefined;
const listeners = new Set<() => void>();
const snapshot = () => controller;
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
const publish = () => listeners.forEach(listener => listener());

/** The deferred root owns the session operation; route changes only remove its controls. */
export function registerCustomerLogout(next: Controller) {
    controller = next;
    publish();
    return () => {
        if (controller !== next) return;
        controller = undefined;
        publish();
    };
}

export function useRouteCustomerLogout(runtime: RouteRuntime) {
    const current = useSyncExternalStore(subscribe, snapshot, snapshot);
    const logoutCustomer = useCallback(async () => {
        const owner = snapshot();
        if (owner?.scope === runtime.market.code) return owner.logoutCustomer();
        runtime.notify({
            type: 'error',
            message:
                runtime.language === 'zh'
                    ? '退出功能尚未载入，请重试'
                    : 'Sign-out is still loading. Please retry.',
        });
        return false;
    }, [runtime.market.code, runtime.language, runtime.notify]);
    return { logoutCustomer, logoutPending: current?.scope === runtime.market.code && current.logoutPending };
}

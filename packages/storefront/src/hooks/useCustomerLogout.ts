import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type ShopApi } from '../api';
import { SupersededLogoutError } from '../api/logout-error';
import { type QueryLoadState } from '../loading-state';
import { type ActiveCustomer, type StorefrontLanguage } from '../types';

interface LogoutOptions {
    api: Pick<ShopApi, 'logout'>;
    scope: string;
    customer: Pick<ActiveCustomer, 'id'> | null;
    customerLoadState: QueryLoadState;
    customerQueryKey: QueryKey;
    language: StorefrontLanguage;
    clearPrivateQueryCache: () => void;
    setCustomer: (customer: ActiveCustomer | null) => void;
    notify: (payload: string | { message: string; type: 'error' }) => void;
}

export function useCustomerLogout(options: LogoutOptions) {
    const queryClient = useQueryClient();
    const pending = useRef(false);
    const mounted = useRef(true);
    const latest = useRef(options);
    latest.current = options;
    const [logoutPending, setLogoutPending] = useState(false);
    const [uncertainScope, setUncertainScope] = useState<string | null>(null);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        if (!uncertainScope) return;
        if (uncertainScope !== options.scope) {
            setUncertainScope(null);
        } else if (options.customerLoadState === 'ready' && options.customer === null) {
            // The existing identity query reconciles an ambiguous response on focus/reconnect.
            options.clearPrivateQueryCache();
            setUncertainScope(null);
        }
    }, [
        uncertainScope,
        options.scope,
        options.customer,
        options.customerLoadState,
        options.clearPrivateQueryCache,
    ]);

    const logoutCustomer = useCallback(async (): Promise<boolean> => {
        if (pending.current) return false;
        const owner = latest.current;
        const currentOwner = () => {
            const current = latest.current;
            return mounted.current &&
                current.scope === owner.scope &&
                (current.customer === null || current.customer.id === owner.customer?.id)
                ? current
                : null;
        };
        pending.current = true;
        setLogoutPending(true);
        try {
            const assertCurrent = await owner.api.logout();
            if (assertCurrent) assertCurrent();
            const current = currentOwner();
            if (!current) return false;
            setUncertainScope(null);
            current.clearPrivateQueryCache();
            current.setCustomer(null);
            current.notify(current.language === 'zh' ? '已退出登录' : 'Signed out');
            return true;
        } catch (error) {
            if (error instanceof SupersededLogoutError) return false;
            const current = currentOwner();
            if (current) {
                setUncertainScope(owner.scope);
                current.notify({
                    message:
                        current.language === 'zh'
                            ? '退出结果未确认，请重试；联网后会核对登录状态'
                            : 'Sign-out unconfirmed. Retry or reconnect.',
                    type: 'error',
                });
                // Mark only the existing identity read stale; never replay the mutation.
                void queryClient.invalidateQueries({
                    queryKey: owner.customerQueryKey,
                    exact: true,
                    refetchType: 'none',
                });
            }
            return false;
        } finally {
            pending.current = false;
            if (mounted.current) setLogoutPending(false);
        }
    }, [queryClient]);

    return { logoutCustomer, logoutPending };
}

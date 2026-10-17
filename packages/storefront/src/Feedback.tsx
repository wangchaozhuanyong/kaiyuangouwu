import { useEffect } from 'react';

import { useCustomerLogout } from './hooks/useCustomerLogout';
import { languageCodeFor } from './i18n';
import { registerCustomerLogout } from './logout';
import { storefrontQueryKeys } from './query-client';
import { type StorefrontContextValue } from './StorefrontContext';
import { StorefrontQueryFeedback } from './StorefrontQueryFeedback';

export function Feedback({ runtime }: { runtime: StorefrontContextValue }) {
    const logout = useCustomerLogout({
        api: runtime.api,
        scope: runtime.market.code,
        customer: runtime.customer,
        customerLoadState: runtime.customerLoadState,
        customerQueryKey: storefrontQueryKeys.customer(
            storefrontQueryKeys.market(runtime.market),
            languageCodeFor(runtime.language),
        ),
        language: runtime.language,
        clearPrivateQueryCache: runtime.clearPrivateQueryCache,
        setCustomer: runtime.setCustomer,
        notify: runtime.notify,
    });
    useEffect(
        () => registerCustomerLogout({ ...logout, scope: runtime.market.code }),
        [runtime.market.code, logout.logoutCustomer, logout.logoutPending],
    );
    return (
        <StorefrontQueryFeedback
            language={runtime.language}
            scope={{
                marketCode: storefrontQueryKeys.market(runtime.market),
                languageCode: languageCodeFor(runtime.language),
                includePrivate: true,
            }}
        />
    );
}

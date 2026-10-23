// organize-imports-ignore -- Preserve ESLint type/value import groups.
import type { CurrencySelectionOptions } from '../cart/currency-selection';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { storefrontErrorMessage } from '../storefront-errors';

/** Load payment preference coordination only when the customer confirms a selection. */
export function useStorefrontCurrencySelection(options: CurrencySelectionOptions) {
    const { api, cartController, customerId, language } = options;
    const owner = useMemo(() => ({}), [api, cartController, customerId]);
    const ownerRef = useRef(owner);
    ownerRef.current = owner;
    const pending = useRef<AbortController | null>(null);
    useEffect(() => () => pending.current?.abort(), [owner]);

    return useCallback(
        async (currencyCode: string) => {
            if (pending.current || options.cartLoading)
                throw new Error(language === 'zh' ? '请先核对购物车' : 'Review your cart first.');
            const request = new AbortController();
            pending.current = request;
            options.setCartLoading(true);
            try {
                const { confirmCurrencySelection } = await import('../cart/currency-selection').catch(
                    error => {
                        throw new Error(storefrontErrorMessage(error, language));
                    },
                );
                await confirmCurrencySelection(
                    options,
                    currencyCode,
                    request.signal,
                    () => ownerRef.current === owner,
                );
            } finally {
                if (pending.current === request) {
                    pending.current = null;
                    options.setCartLoading(false);
                }
            }
        },
        [options, language, owner],
    );
}

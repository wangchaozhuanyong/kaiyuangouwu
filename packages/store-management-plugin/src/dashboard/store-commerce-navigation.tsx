import { api, useChannel, useQuery } from '@vendure/dashboard';
import { ReactNode } from 'react';

import { hiddenNavigationIds } from './store-commerce-navigation-rules';
import { MyStoreCommerceModeResult, myStoreCommerceModeQuery } from './store-commerce.graphql';

export function StoreCommerceNavigation({ children }: Readonly<{ children: ReactNode }>) {
    const { activeChannel } = useChannel();
    const modeQuery = useQuery({
        queryKey: ['store-commerce-mode-navigation', activeChannel?.id],
        queryFn: () => api.query<MyStoreCommerceModeResult>(myStoreCommerceModeQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const mode = modeQuery.data?.myStoreCommerceMode.mode;
    const hiddenIds = mode ? hiddenNavigationIds(mode) : [];
    const style = hiddenIds
        .map(id => `[data-navigation-id="${id}"] { display: none !important; }`)
        .join('\n');

    return (
        <>
            {children}
            {style && <style data-store-commerce-navigation={mode}>{style}</style>}
        </>
    );
}

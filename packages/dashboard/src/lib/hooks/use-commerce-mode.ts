import { useQuery } from '@tanstack/react-query';

import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from './use-channel.js';

const dashboardCommerceModeDocument = graphql(`
    query DashboardCommerceMode {
        myStoreCommerceMode {
            mode
        }
    }
`);

export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
export type CommerceFulfillmentType = 'physical' | 'digital';

interface DashboardCommerceModeResult {
    myStoreCommerceMode: {
        mode: StoreCommerceMode;
    };
}

export function fixedFulfillmentTypeForMode(
    mode: StoreCommerceMode | undefined,
): CommerceFulfillmentType | undefined {
    if (mode === 'DIGITAL_ONLY') return 'digital';
    if (mode === 'PHYSICAL_ONLY') return 'physical';
    return undefined;
}

export function useCommerceMode() {
    const { activeChannel } = useChannel();
    const query = useQuery({
        queryKey: ['dashboard-commerce-mode', activeChannel?.id],
        queryFn: () => api.query<DashboardCommerceModeResult>(dashboardCommerceModeDocument),
        enabled: Boolean(activeChannel?.id),
    });
    const mode = query.data?.myStoreCommerceMode.mode;

    return {
        mode,
        fixedFulfillmentType: fixedFulfillmentTypeForMode(mode),
        isLoading: query.isLoading,
        isError: query.isError,
    };
}

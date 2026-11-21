import type { ShopApi } from '../api';

import { environmentNetworkReportOperation } from './environment-monitor';
import { createRequestSignal, parseShopApiResponse, SHOP_API_QUERY_TIMEOUT_MS } from './helpers';

/** The isolated origin accepts only the existing anonymous environment report operation. */
export const standaloneEnvironmentMonitorApi: Pick<ShopApi, 'request'> = {
    async request<T>(operation: string, variables?: Record<string, unknown>, signal?: AbortSignal) {
        if (operation !== environmentNetworkReportOperation) {
            throw new Error('ENVIRONMENT_NETWORK_UNAVAILABLE');
        }
        const headers = new Headers();
        if (typeof variables?.observedIpv4 === 'string') {
            headers.set('X-Environment-Observed-Ipv4', variables.observedIpv4);
        }
        if (typeof variables?.observedIpv6 === 'string') {
            headers.set('X-Environment-Observed-Ipv6', variables.observedIpv6);
        }
        const request = createRequestSignal(signal, SHOP_API_QUERY_TIMEOUT_MS);
        try {
            const response = await fetch('/api/environment/network', {
                method: 'POST',
                headers,
                signal: request.signal,
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
                referrerPolicy: 'no-referrer',
            });
            if (response.status === 429) throw new Error('ENVIRONMENT_RATE_LIMIT');
            return parseShopApiResponse<T>(await response.text(), response.status, response.ok);
        } finally {
            request.cleanup();
        }
    },
};

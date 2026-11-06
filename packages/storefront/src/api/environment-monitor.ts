import type { EnvironmentNetworkReport } from '../../../storefront-content-plugin/src/environment-monitor-contract';
import type { ShopApi } from '../api';

import { readBrowserNetworkAddresses, type BrowserNetworkAddresses } from './browser-network-addresses';

const networkIssueCodes = ['DAILY_LIMIT', 'RATE_LIMIT', 'ADDRESS_UNAVAILABLE'] as const;

export function environmentNetworkIssue(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return networkIssueCodes.find(code => message.includes(code)) ?? 'UNAVAILABLE';
}

export async function requestEnvironmentNetworkReport(
    api: Pick<ShopApi, 'request'>,
    signal?: AbortSignal,
    observe: (signal?: AbortSignal) => Promise<BrowserNetworkAddresses> = readBrowserNetworkAddresses,
): Promise<EnvironmentNetworkReport> {
    const addresses = await observe(signal);
    signal?.throwIfAborted();
    const variables =
        addresses.ipv4 || addresses.ipv6
            ? { observedIpv4: addresses.ipv4, observedIpv6: addresses.ipv6 }
            : undefined;
    const result = await api.request<{ environmentNetworkReport: EnvironmentNetworkReport }>(
        `query EnvironmentNetworkReport($observedIpv4: String, $observedIpv6: String) {
                environmentNetworkReport(observedIpv4: $observedIpv4, observedIpv6: $observedIpv6) {
                    checkedAt provider ip ipv4 ipv6 addressSource maskedIp cached lookupIssue country countryCode region city
                    postalCode latitude longitude geoProvider timezone isp asn connectionType
                    fraudScore proxy vpn tor
                }
            }`,
        variables,
        signal,
    );
    const report = result?.environmentNetworkReport;
    if (
        !report ||
        !['IPDB', 'IPQS', 'REQUEST'].includes(report.provider) ||
        typeof report.ip !== 'string' ||
        !report.ip ||
        !Number.isFinite(Date.parse(report.checkedAt)) ||
        (!!(addresses.ipv4 || addresses.ipv6) && report.ip !== (addresses.ipv4 || addresses.ipv6))
    )
        throw new Error('ENVIRONMENT_NETWORK_UNAVAILABLE');
    return report;
}

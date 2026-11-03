/** Shared transport only. Browser signals never enter this contract. */
export interface EnvironmentNetworkReport {
    checkedAt: string;
    provider: 'IPDB' | 'IPQS' | 'REQUEST';
    ip: string;
    /** Informational browser observations, never authentication or rate-limit identity. */
    ipv4?: string | null;
    ipv6?: string | null;
    addressSource?: 'BROWSER' | 'CONNECTION';
    maskedIp: string;
    cached: boolean;
    lookupIssue: 'UNAVAILABLE' | 'DAILY_LIMIT' | null;
    country: string | null;
    countryCode: string | null;
    region: string | null;
    city: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    geoProvider: 'IPDB' | 'IPQS' | 'IPGUIDE' | 'FREEIPAPI' | 'IPWHOIS' | null;
    timezone: string | null;
    isp: string | null;
    asn: string | null;
    connectionType: string | null;
    fraudScore: number | null;
    proxy: boolean | null;
    vpn: boolean | null;
    tor: boolean | null;
}

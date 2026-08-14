export type StoreDomainRoutingMode = 'prefer-domain' | 'require-domain';

export interface StoreDomainPluginOptions {
    /** DNS target shown to merchants when they connect a CNAME or ALIAS record. */
    cnameTarget: string;
    /** Reject unknown Shop API hosts in production, or preserve token-based local development. */
    routingMode?: StoreDomainRoutingMode;
    /** Read x-forwarded-host only when the trusted ingress always overwrites it. */
    trustProxyHeaders?: boolean;
    /** Hosts which keep token routing. Defaults to none in production and localhost in development. */
    bypassHosts?: string[];
    /** Test seam for DNS TXT lookup. */
    resolveTxt?: (hostname: string) => Promise<string[][]>;
}

export type StoreDomainStatus = 'PENDING' | 'ACTIVE';

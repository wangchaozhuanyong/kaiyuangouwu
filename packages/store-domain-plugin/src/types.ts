export type StoreDomainRoutingMode = 'prefer-domain' | 'require-domain';

export type StoreDomainProvisioningMode = 'MANUAL' | 'CLOUDFLARE_SAAS';

export interface CloudflareSaasDomainAutomationOptions {
    /** Scoped API token. Never expose this value through GraphQL or logs. */
    apiToken: string;
    /** Cloudflare zone which owns the SaaS custom-hostname configuration. */
    saasZoneId: string;
    /** Proxied hostname Cloudflare should use when connecting to the Vendure origin. */
    fallbackOrigin: string;
    /** Automatically create DNS records when the customer zone is available to the same token. */
    autoManageDns?: boolean;
    /** Test seam; production uses https://api.cloudflare.com/client/v4. */
    apiBaseUrl?: string;
    /** Test seam for Cloudflare API calls. */
    fetch?: typeof fetch;
}

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
    /** Optional Cloudflare for SaaS custom-hostname and DNS automation. */
    cloudflare?: CloudflareSaasDomainAutomationOptions;
}

export interface ResolvedStoreDomainPluginOptions {
    cnameTarget: string;
    routingMode: StoreDomainRoutingMode;
    trustProxyHeaders: boolean;
    bypassHosts: string[];
    resolveTxt: (hostname: string) => Promise<string[][]>;
    cloudflare:
        | (CloudflareSaasDomainAutomationOptions & {
              autoManageDns: boolean;
              apiBaseUrl: string;
              fetch: typeof fetch;
          })
        | null;
}

export type StoreDomainStatus = 'PENDING' | 'ACTIVE';

export interface TransferStoreDomainInput {
    id: string | number;
    targetChannelId: string | number;
    expectedUpdatedAt: Date;
}

export interface StoreDomainAutomationResult {
    externalId: string;
    dnsManaged: boolean;
    hostnameStatus: string | null;
    sslStatus: string | null;
    ready: boolean;
    message: string;
}

export interface StorefrontCdnPurgeConfiguration {
    zone?: string;
    zones?: Map<string, string>;
    token: string;
}

/** One strict routing contract for startup validation and exact-URL purge jobs. */
export function storefrontCdnPurgeConfiguration(
    env: NodeJS.ProcessEnv = process.env,
): StorefrontCdnPurgeConfiguration {
    const zones = purgeZones(env.STOREFRONT_CLOUDFLARE_ZONES);
    const zone = env.STOREFRONT_CLOUDFLARE_ZONE_ID;
    const token = env.STOREFRONT_CLOUDFLARE_PURGE_TOKEN;
    if (!token?.trim() || (!zones && (!zone || !/^[a-f0-9]{32}$/iu.test(zone))))
        throw new Error('Exact media purge configuration is incomplete');
    return { zones, zone, token };
}

function purgeZones(source: string | undefined): Map<string, string> | undefined {
    if (!source) return;
    let mapping: unknown;
    try {
        mapping = JSON.parse(source) as unknown;
    } catch {
        throw new Error('Exact media purge hostname map is invalid');
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
        throw new Error('Exact media purge hostname map is invalid');
    const entries = Object.entries(mapping as Record<string, unknown>);
    if (!entries.length) throw new Error('Exact media purge hostname map is invalid');
    const zones = new Map<string, string>();
    for (const [hostname, zone] of entries) {
        let canonicalHostname: string;
        try {
            canonicalHostname = new URL(`https://${hostname}`).hostname;
        } catch {
            throw new Error('Exact media purge hostname map is invalid');
        }
        if (
            hostname.length > 253 ||
            !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
            canonicalHostname !== hostname ||
            typeof zone !== 'string' ||
            !/^[a-f0-9]{32}$/iu.test(zone)
        )
            throw new Error('Exact media purge hostname map is invalid');
        zones.set(hostname, zone.toLowerCase());
    }
    return zones;
}

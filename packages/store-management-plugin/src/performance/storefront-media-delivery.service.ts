import { Injectable } from '@nestjs/common';
import { ConfigService, ID } from '@vendure/core';

interface DeliverySetStrategy {
    addToBoundedSet?(key: string, value: string, limit: number, ttlSeconds: number): Promise<boolean>;
    boundedSetMembers?(key: string): Promise<string[]>;
}

/** Exact public URLs only. No wildcard purge and no request headers or private URLs in jobs. */
@Injectable()
export class StorefrontMediaDeliveryService {
    constructor(private readonly config: ConfigService) {}

    get purgeEnabled(): boolean {
        return process.env.STOREFRONT_CDN_PURGE_ENABLED === 'true';
    }

    async record(channelId: ID, host: string, requestUrl: string): Promise<boolean> {
        if (!this.purgeEnabled) return true;
        const url = this.publicUrl(requestUrl, host);
        const strategy = this.config.systemOptions.cacheStrategy as DeliverySetStrategy;
        if (!url || !strategy.addToBoundedSet) return false;
        try {
            if (
                !(await strategy.addToBoundedSet(
                    'storefront-public:v1:delivered-channels',
                    String(channelId),
                    256,
                    600,
                ))
            )
                return false;
            return await strategy.addToBoundedSet(this.key(channelId), url, 8192, 600);
        } catch {
            return false;
        }
    }

    async urls(channelId: ID): Promise<string[]> {
        const strategy = this.config.systemOptions.cacheStrategy as DeliverySetStrategy;
        if (!strategy.boundedSetMembers)
            throw new Error('Exact media purge requires the shared delivery ledger');
        return strategy.boundedSetMembers(this.key(channelId));
    }

    async channels(): Promise<string[]> {
        const strategy = this.config.systemOptions.cacheStrategy as DeliverySetStrategy;
        if (!strategy.boundedSetMembers)
            throw new Error('Exact media purge requires the shared delivery ledger');
        return strategy.boundedSetMembers('storefront-public:v1:delivered-channels');
    }

    async purge(urls: string[]): Promise<{ status: 'disabled' | 'purged'; count: number }> {
        if (!this.purgeEnabled) return { status: 'disabled', count: 0 };
        const zone = process.env.STOREFRONT_CLOUDFLARE_ZONE_ID;
        const token = process.env.STOREFRONT_CLOUDFLARE_PURGE_TOKEN;
        if (!zone || !/^[a-f0-9]{32}$/iu.test(zone) || !token)
            throw new Error('Exact media purge configuration is incomplete');
        const files = [...new Set(urls)];
        if (
            files.length > 8192 ||
            files.some(url => {
                try {
                    return this.publicUrl(url, new URL(url).host) !== url;
                } catch {
                    return true;
                }
            })
        )
            throw new Error('Invalid public media purge batch');
        for (let start = 0; start < files.length; start += 30) {
            const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: files.slice(start, start + 30) }),
                signal: AbortSignal.timeout(5000),
            });
            const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
            if (!response.ok || result?.success !== true) throw new Error('Exact media CDN purge failed');
        }
        return { status: 'purged', count: files.length };
    }

    private publicUrl(source: string, host: string): string | undefined {
        try {
            const url = new URL(source, `https://${host}`);
            if (source.length > 2048 || url.pathname.length > 1024 || [...url.searchParams].length > 10)
                return;
            if (
                url.protocol !== 'https:' ||
                url.host !== host ||
                url.username ||
                url.password ||
                url.hash ||
                !/^\/assets\/(?:preview|source)\//u.test(url.pathname)
            )
                return;
            if (
                [...url.searchParams].some(
                    ([key, value]) =>
                        !['preset', 'format', 'q', 'v', 'w', 'h', 'mode', 'fpx', 'fpy', 'cache'].includes(
                            key,
                        ) || value.length > 100,
                )
            )
                return;
            return url.toString();
        } catch {
            return;
        }
    }

    private key(channelId: ID): string {
        return `storefront-public:v1:delivered:${String(channelId)}`;
    }
}

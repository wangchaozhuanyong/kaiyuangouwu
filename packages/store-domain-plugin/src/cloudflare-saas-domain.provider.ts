import { normalizeDomain } from './domain-utils';
import { ResolvedStoreDomainPluginOptions, StoreDomainAutomationResult } from './types';

type CloudflareOptions = NonNullable<ResolvedStoreDomainPluginOptions['cloudflare']>;

interface CloudflareEnvelope<T> {
    success: boolean;
    result: T;
    errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareCustomHostname {
    id: string;
    hostname: string;
    status?: string;
    ssl?: { status?: string };
}

interface CloudflareZone {
    id: string;
    name: string;
    status?: string;
}

interface CloudflareDnsRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
}

interface CloudflareFallbackOrigin {
    origin?: string;
    status?: string;
}

export class CloudflareSaasDomainProvider {
    private fallbackOriginReady = false;

    constructor(private readonly options: CloudflareOptions) {}

    async provision(input: {
        domain: string;
        cnameTarget: string;
        verificationRecordName: string;
        verificationRecordValue: string;
    }): Promise<StoreDomainAutomationResult> {
        const domain = normalizeDomain(input.domain);
        const cnameTarget = normalizeDomain(input.cnameTarget);
        if (domain === cnameTarget) {
            throw new Error('平台 CNAME 目标不能绑定到自身');
        }

        await this.assertFallbackOrigin();
        const customHostname = await this.ensureCustomHostname(domain);
        let dnsManaged = false;
        if (this.options.autoManageDns) {
            try {
                const zone = await this.findManagedZone(domain);
                if (zone) {
                    await this.ensureTrafficRecord(zone.id, domain, cnameTarget);
                    await this.ensureTxtRecord(
                        zone.id,
                        input.verificationRecordName,
                        input.verificationRecordValue,
                    );
                    dnsManaged = true;
                }
            } catch (error) {
                const detail = error instanceof Error ? error.message : '未知错误';
                return {
                    ...this.toResult(customHostname, false),
                    ready: false,
                    message: `Cloudflare 自定义主机名已保留，但 DNS 自动配置失败：${detail}`,
                };
            }
        }

        const current = await this.getCustomHostname(customHostname.id);
        return this.toResult(current, dnsManaged);
    }

    async inspect(externalId: string, dnsManaged: boolean): Promise<StoreDomainAutomationResult> {
        return this.toResult(await this.getCustomHostname(externalId), dnsManaged);
    }

    async remove(externalId: string): Promise<void> {
        await this.request<unknown>(
            `/zones/${encodeURIComponent(this.options.saasZoneId)}/custom_hostnames/${encodeURIComponent(externalId)}`,
            { method: 'DELETE' },
        );
    }

    private async ensureCustomHostname(domain: string): Promise<CloudflareCustomHostname> {
        const matches = await this.request<CloudflareCustomHostname[]>(
            `/zones/${encodeURIComponent(this.options.saasZoneId)}/custom_hostnames?hostname.exact=${encodeURIComponent(domain)}&ssl=1&per_page=5`,
        );
        const exact = matches.filter(item => normalizeDomain(item.hostname) === domain);
        if (exact.length > 1) {
            throw new Error(`Cloudflare 存在多个重复的自定义主机名：${domain}`);
        }
        if (exact[0]) {
            return exact[0];
        }

        return this.request<CloudflareCustomHostname>(
            `/zones/${encodeURIComponent(this.options.saasZoneId)}/custom_hostnames`,
            {
                method: 'POST',
                body: JSON.stringify({
                    hostname: domain,
                    ssl: { method: 'http', type: 'dv', wildcard: false },
                }),
            },
        );
    }

    private getCustomHostname(externalId: string): Promise<CloudflareCustomHostname> {
        return this.request<CloudflareCustomHostname>(
            `/zones/${encodeURIComponent(this.options.saasZoneId)}/custom_hostnames/${encodeURIComponent(externalId)}`,
        );
    }

    private async assertFallbackOrigin(): Promise<void> {
        if (this.fallbackOriginReady) {
            return;
        }
        const fallback = await this.request<CloudflareFallbackOrigin>(
            `/zones/${encodeURIComponent(this.options.saasZoneId)}/custom_hostnames/fallback_origin`,
        );
        const actual = fallback.origin ? normalizeDomain(fallback.origin) : '';
        if (actual !== normalizeDomain(this.options.fallbackOrigin) || fallback.status !== 'active') {
            throw new Error(
                `Cloudflare fallback origin 未就绪（期望 ${this.options.fallbackOrigin}，状态 ${fallback.status ?? 'unknown'}）`,
            );
        }
        this.fallbackOriginReady = true;
    }

    private async findManagedZone(domain: string): Promise<CloudflareZone | null> {
        const labels = domain.split('.');
        for (let index = 0; index <= labels.length - 2; index++) {
            const name = labels.slice(index).join('.');
            const zones = await this.request<CloudflareZone[]>(
                `/zones?name=${encodeURIComponent(name)}&status=active&per_page=50`,
            );
            const exact = zones.find(
                zone => normalizeDomain(zone.name) === name && zone.status !== 'deleted',
            );
            if (exact) {
                return exact;
            }
        }
        return null;
    }

    private async ensureTrafficRecord(zoneId: string, name: string, target: string): Promise<void> {
        const records = await this.listDnsRecords(zoneId, name);
        const matching = records.find(
            record => record.type === 'CNAME' && normalizeDomain(record.content) === target,
        );
        if (matching) {
            if (matching.proxied !== true) {
                await this.request<CloudflareDnsRecord>(
                    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(matching.id)}`,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({ proxied: true }),
                    },
                );
            }
            return;
        }
        if (records.some(record => ['A', 'AAAA', 'CNAME'].includes(record.type))) {
            throw new Error(`${name} 已有冲突的 A、AAAA 或 CNAME 记录，未自动覆盖`);
        }
        await this.request<CloudflareDnsRecord>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
            method: 'POST',
            body: JSON.stringify({ type: 'CNAME', name, content: target, proxied: true, ttl: 1 }),
        });
    }

    private async ensureTxtRecord(zoneId: string, name: string, value: string): Promise<void> {
        const records = await this.listDnsRecords(zoneId, name);
        if (records.some(record => record.type === 'TXT' && this.normalizeTxt(record.content) === value)) {
            return;
        }
        await this.request<CloudflareDnsRecord>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
            method: 'POST',
            body: JSON.stringify({ type: 'TXT', name, content: value, ttl: 1 }),
        });
    }

    private listDnsRecords(zoneId: string, name: string): Promise<CloudflareDnsRecord[]> {
        return this.request<CloudflareDnsRecord[]>(
            `/zones/${encodeURIComponent(zoneId)}/dns_records?name.exact=${encodeURIComponent(name)}&per_page=100`,
        );
    }

    private normalizeTxt(value: string): string {
        return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    }

    private toResult(
        customHostname: CloudflareCustomHostname,
        dnsManaged: boolean,
    ): StoreDomainAutomationResult {
        const hostnameStatus = customHostname.status ?? null;
        const sslStatus = customHostname.ssl?.status ?? null;
        const ready = hostnameStatus === 'active' && sslStatus === 'active';
        return {
            externalId: customHostname.id,
            dnsManaged,
            hostnameStatus,
            sslStatus,
            ready,
            message: ready
                ? 'Cloudflare 路由和 SSL 证书已生效'
                : dnsManaged
                  ? `Cloudflare 正在生效（主机：${hostnameStatus ?? 'unknown'}，SSL：${sslStatus ?? 'unknown'}）`
                  : '该域名不在当前 Cloudflare 账户中，请按页面提示添加 DNS 记录',
        };
    }

    private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const response = await this.options.fetch(`${this.options.apiBaseUrl}${path}`, {
            ...init,
            headers: {
                authorization: `Bearer ${this.options.apiToken}`,
                'content-type': 'application/json',
                ...init.headers,
            },
            signal: init.signal ?? AbortSignal.timeout(10_000),
        });
        let payload: CloudflareEnvelope<T> | undefined;
        try {
            payload = (await response.json()) as CloudflareEnvelope<T>;
        } catch {
            // The status code below is enough for an actionable, non-secret error.
        }
        if (!response.ok || payload?.success !== true) {
            const details = payload?.errors
                ?.map(error => error.message?.trim())
                .filter(Boolean)
                .slice(0, 3)
                .join('；');
            throw new Error(
                `Cloudflare API 请求失败（HTTP ${response.status}）${details ? `：${details}` : ''}`,
            );
        }
        return payload.result;
    }
}

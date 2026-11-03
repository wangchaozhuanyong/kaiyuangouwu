import { Injectable } from '@nestjs/common';
import { RequestContext, UserInputError } from '@vendure/core';
import type { EnvironmentNetworkReport } from '@vendure/storefront-content-plugin';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { ShopAbuseStore } from '../abuse-protection/store';
import { storefrontClientIp } from '../referral/storefront-client-ip';
import { StorefrontActivationService } from '../storefront-activation.service';
import { StorefrontClientPluginAccessService } from '../storefront-client-plugin-access.service';

import { readFreeIpApiReport } from './free-ip-api-client';
import { readIpGuideReport } from './ip-guide-client';
import { readIpDbReport } from './ipdb-client';
import { readIpWhoisReport } from './ipwhois-client';

const digest = (input: string) => createHash('sha256').update(input).digest('hex');
const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null;
const coordinate = (value: unknown, max: number): number | null =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max ? value : null;
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** A partial result must stay retryable rather than freezing missing fields for ten minutes. */
function canCacheReport(report: EnvironmentNetworkReport): boolean {
    const type = (report.connectionType ?? '').toLowerCase();
    const knownType =
        /residen|^isp$|datacenter|data.center|hosting|vpn|proxy|tor|mobile|cellular|business|corporate|education|government/.test(
            type,
        );
    const knownProxy =
        typeof report.proxy === 'boolean' ||
        report.vpn === true ||
        report.tor === true ||
        /vpn|proxy|tor/.test(type);
    if (
        report.provider === 'REQUEST' ||
        report.lookupIssue ||
        report.geoProvider === 'IPDB' ||
        !report.postalCode ||
        report.fraudScore === null ||
        !knownType ||
        !knownProxy ||
        !report.timezone
    )
        return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: report.timezone }).format(new Date(report.checkedAt));
        return true;
    } catch {
        return false;
    }
}

export function normalizeNetworkReport(data: Record<string, unknown>, ip: string): EnvironmentNetworkReport {
    const score = data.fraud_score;
    return {
        checkedAt: new Date().toISOString(),
        provider: 'IPQS',
        ip,
        ipv4: isIP(ip) === 4 ? ip : null,
        ipv6: isIP(ip) === 6 ? ip : null,
        addressSource: 'CONNECTION',
        cached: false,
        lookupIssue: null,
        maskedIp:
            isIP(ip) === 4
                ? `${ip.split('.').slice(0, 2).join('.')}.*.*`
                : `${ip.split(':').slice(0, 2).join(':')}:…`,
        country: text(data.country_name) ?? text(data.country_code),
        countryCode: text(data.country_code),
        city: text(data.city),
        postalCode: text(data.zip_code),
        latitude: coordinate(data.latitude, 90),
        longitude: coordinate(data.longitude, 180),
        geoProvider: 'IPQS',
        region: text(data.region),
        timezone: text(data.timezone),
        isp: text(data.ISP),
        asn: typeof data.ASN === 'number' && Number.isFinite(data.ASN) ? String(data.ASN) : text(data.ASN),
        connectionType: text(data.connection_type),
        fraudScore:
            typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null,
        proxy: flag(data.proxy),
        vpn: flag(data.vpn),
        tor: flag(data.tor),
    };
}

/** The current connection is observable without contacting any third party. */
export function requestNetworkReport(ip: string): EnvironmentNetworkReport {
    return {
        ...normalizeNetworkReport({}, ip),
        provider: 'REQUEST',
        geoProvider: null,
        lookupIssue: 'UNAVAILABLE',
    };
}

export function normalizeIpDbReport(data: Record<string, unknown>, ip: string): EnvironmentNetworkReport {
    return {
        ...normalizeNetworkReport(
            {
                country_code: data.country_code ?? data.country,
                region: data.region,
                city: data.city,
                country_name: data.country,
                latitude: data.latitude,
                longitude: data.longitude,
                zip_code: data.postal_code,
                timezone: data.timezone,
                ISP: data.organization,
                ASN: data.asn,
                connection_type: data.network_type,
                fraud_score: data.score,
                proxy:
                    typeof data.proxy === 'boolean'
                        ? data.proxy
                        : data.network_type === 'proxy'
                          ? true
                          : null,
                vpn: typeof data.vpn === 'boolean' ? data.vpn : data.network_type === 'vpn' ? true : null,
                tor: typeof data.tor === 'boolean' ? data.tor : data.network_type === 'tor' ? true : null,
            },
            ip,
        ),
        provider: 'IPDB',
        geoProvider: 'IPDB',
    };
}

/** Fixed vendor endpoints; public informational lookups never select an authenticated identity. */
@Injectable()
export class EnvironmentMonitorService {
    private readonly cache = new Map<string, { until: number; report: EnvironmentNetworkReport }>();
    private readonly pending = new Map<string, Promise<EnvironmentNetworkReport>>();

    constructor(
        private readonly access: StorefrontClientPluginAccessService,
        private readonly activation: StorefrontActivationService,
        private readonly budgets: ShopAbuseStore,
    ) {}

    async lookup(
        ctx: RequestContext,
        req: Request,
        observedIpv4?: string | null,
        observedIpv6?: string | null,
    ): Promise<EnvironmentNetworkReport> {
        await this.activation.assertActive(ctx);
        await this.access.assertEnabled(ctx, 'environment-monitor-entry');
        const key = process.env.ENVIRONMENT_MONITOR_IPQS_KEY?.trim();
        // req.ip is normalized by Express using the deployment's existing trust-proxy policy.
        // Browser-reported addresses are untrusted informational targets only. Admission and
        // rate limits always use Express's trusted connection address, never the supplied target.
        const connectionIp = storefrontClientIp(req);
        if (!connectionIp || !isPublicAddress(connectionIp))
            throw new UserInputError('ENVIRONMENT_NETWORK_ADDRESS_UNAVAILABLE');
        for (const [value, version] of [
            [observedIpv4, 4],
            [observedIpv6, 6],
        ] as const)
            if (value != null && (isIP(value) !== version || !isPublicAddress(value)))
                throw new UserInputError('ENVIRONMENT_NETWORK_ADDRESS_UNAVAILABLE');
        const ip = observedIpv4 ?? observedIpv6 ?? connectionIp;
        const addresses = (report: EnvironmentNetworkReport): EnvironmentNetworkReport => ({
            ...report,
            ipv4: observedIpv4 ?? (isIP(ip) === 4 ? ip : null),
            ipv6: observedIpv6 ?? (isIP(ip) === 6 ? ip : null),
            addressSource: observedIpv4 || observedIpv6 ? 'BROWSER' : 'CONNECTION',
        });
        const admission = await this.budgets.consume(
            digest(`environment-monitor:ip:${connectionIp}`),
            5,
            60_000,
        );
        if (!admission.allowed) throw new UserInputError('ENVIRONMENT_NETWORK_RATE_LIMIT');
        const provider = key ? 'IPQS' : 'IPDB';
        const cacheKey = digest(`environment-monitor:${provider}:${ctx.channelId}:${ip}`);
        const now = Date.now();
        for (const [id, entry] of this.cache) if (entry.until <= now) this.cache.delete(id);
        const cached = this.cache.get(cacheKey);
        if (cached && canCacheReport(cached.report)) return addresses({ ...cached.report, cached: true });
        if (cached) this.cache.delete(cacheKey);
        const ongoing = this.pending.get(cacheKey);
        if (ongoing) return ongoing.then(addresses);
        // Bound even the in-flight map under a large number of independent visitors.
        if (this.pending.size >= 100) throw new UserInputError('ENVIRONMENT_NETWORK_UNAVAILABLE');
        const task = (key ? this.fetchReport(key, ip) : this.fetchFreeReport(ip))
            .then(report => {
                if (canCacheReport(report)) {
                    if (this.cache.size >= 500) {
                        const oldest = this.cache.keys().next().value;
                        if (oldest !== undefined) this.cache.delete(oldest);
                    }
                    this.cache.set(cacheKey, { until: Date.now() + 600_000, report });
                }
                return report;
            })
            .finally(() => this.pending.delete(cacheKey));
        this.pending.set(cacheKey, task);
        return task.then(addresses);
    }

    private async fetchFreeReport(ip: string): Promise<EnvironmentNetworkReport> {
        // The free postal source publishes 1,000/day; leave headroom for retries and other use.
        // This is our application budget, not a guarantee of the vendor's availability.
        const configured = Number(process.env.ENVIRONMENT_MONITOR_FREE_DAILY_LIMIT);
        const dailyLimit =
            Number.isSafeInteger(configured) && configured >= 1 && configured <= 900 ? configured : 900;
        const admission = await this.budgets.consume(
            digest('environment-monitor:free:daily'),
            dailyLimit,
            86_400_000,
        );
        if (!admission.allowed) return { ...requestNetworkReport(ip), lookupIssue: 'DAILY_LIMIT' };
        const [reputation, location, postal] = await Promise.allSettled([
            readIpDbReport(ip),
            readIpGuideReport(ip),
            this.readPostalReport(ip),
        ]);
        let report =
            reputation.status === 'fulfilled'
                ? normalizeIpDbReport(reputation.value, ip)
                : requestNetworkReport(ip);
        if (location.status === 'fulfilled') {
            const geo = location.value.location as Record<string, unknown>;
            const net = location.value.network as { autonomous_system?: Record<string, unknown> } | undefined;
            const owner = net?.autonomous_system;

            const country = text(geo.country);
            let countryCode = report.countryCode;
            if (country && countryCode) {
                try {
                    if (
                        new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode)?.toLowerCase() !==
                        country.toLowerCase()
                    )
                        countryCode = null;
                } catch {
                    countryCode = null;
                }
            }
            report = {
                ...report,
                country: country ?? report.country,
                countryCode,
                city: text(geo.city) ?? report.city,
                timezone: text(geo.timezone),
                latitude: coordinate(geo.latitude, 90),
                longitude: coordinate(geo.longitude, 180),
                geoProvider: 'IPGUIDE',
                isp: report.isp ?? text(owner?.organization) ?? text(owner?.name),
                asn:
                    report.asn ??
                    (typeof owner?.asn === 'number' && Number.isInteger(owner.asn) && owner.asn > 0
                        ? String(owner.asn)
                        : null),
            };
        }
        return postal.status === 'fulfilled' ? this.enrichPostalReport(report, postal.value) : report;
    }

    private async readPostalReport(ip: string): Promise<Record<string, unknown>> {
        // Stay below the vendor's 60/minute free-plan limit, shared across all stores.
        const admission = await this.budgets.consume(digest('environment-monitor:freeipapi'), 50, 60_000);
        if (!admission.allowed) throw new Error('IP location rate limit');
        const readFree = async () => {
            // The same free endpoint also limits bursts to 10 requests per 10 seconds.
            const burst = await this.budgets.consume(
                digest('environment-monitor:freeipapi:burst'),
                8,
                10_000,
            );
            if (!burst.allowed) throw new Error('IP location burst limit');
            return readFreeIpApiReport(ip);
        };
        const [free, whois] = await Promise.allSettled([readFree(), readIpWhoisReport(ip)]);
        const proxy = free.status === 'fulfilled' ? flag(free.value.isProxy) : null;
        if (whois.status === 'fulfilled') {
            const geo = whois.value;
            if (text(geo.postal)) {
                const timezone =
                    geo.timezone && typeof geo.timezone === 'object'
                        ? (geo.timezone as Record<string, unknown>).id
                        : null;
                return {
                    zipCode: geo.postal,
                    countryCode: geo.country_code,
                    countryName: geo.country,
                    cityName: geo.city,
                    regionName: geo.region,
                    latitude: geo.latitude,
                    longitude: geo.longitude,
                    ipTimezone: timezone,
                    isProxy: proxy,
                    source: 'IPWHOIS',
                };
            }
        }
        if (free.status === 'fulfilled') return { ...free.value, source: 'FREEIPAPI' };
        throw new Error('IP location unavailable');
    }

    private enrichPostalReport(
        report: EnvironmentNetworkReport,
        geo: Record<string, unknown>,
    ): EnvironmentNetworkReport {
        const rawPostal = text(geo.zipCode);
        const postalCode =
            rawPostal && !/^(?:unknown|n\/?a|not available|-|null)$/i.test(rawPostal) ? rawPostal : null;
        // Keep postcode, city, region and coordinates from the same location record.
        // A country's list of timezones is not an IP-specific timezone; never take its first entry.
        if (!postalCode) return { ...report, proxy: report.proxy ?? flag(geo.isProxy) };
        const countryCode = text(geo.countryCode);
        const sameCountry = !report.countryCode || !countryCode || report.countryCode === countryCode;
        return {
            ...report,
            postalCode,
            country: text(geo.countryName),
            countryCode,
            region: text(geo.regionName),
            city: text(geo.cityName),
            latitude: coordinate(geo.latitude, 90),
            longitude: coordinate(geo.longitude, 180),
            timezone: text(geo.ipTimezone) ?? (sameCountry ? report.timezone : null),
            geoProvider: geo.source === 'IPWHOIS' ? 'IPWHOIS' : 'FREEIPAPI',
            proxy: report.proxy ?? flag(geo.isProxy),
        };
    }

    private async fetchReport(key: string, ip: string): Promise<EnvironmentNetworkReport> {
        const day = new Date().toISOString().slice(0, 10);
        const admission = await this.budgets.consume(
            digest(`environment-monitor:vendor:${day}`),
            100,
            86_400_000,
        );
        if (!admission.allowed) return { ...requestNetworkReport(ip), lookupIssue: 'DAILY_LIMIT' };
        const url = new URL('https://ipqualityscore.com/api/json/ip');
        url.searchParams.set('ip', ip);
        url.searchParams.set('strictness', '0');
        url.searchParams.set('allow_public_access_points', 'true');
        try {
            const response = await fetch(url, {
                headers: { 'IPQS-KEY': key, Accept: 'application/json' },
                signal: AbortSignal.timeout(5_000),
                redirect: 'error',
            });
            if (!response.ok) throw new Error('upstream');
            const data: unknown = await response.json();
            if (
                !data ||
                typeof data !== 'object' ||
                Array.isArray(data) ||
                (data as Record<string, unknown>).success !== true
            )
                throw new Error('upstream');
            const report = normalizeNetworkReport(data as Record<string, unknown>, ip);
            if (report.postalCode) return report;
            try {
                return this.enrichPostalReport(report, await this.readPostalReport(ip));
            } catch {
                return report;
            }
        } catch {
            // Do not expose vendor URLs, bodies, request details, or credentials in API errors/logs.
            return requestNetworkReport(ip);
        }
    }
}

export function isPublicAddress(ip: string): boolean {
    if (isIP(ip) === 4) {
        const [a, b, c] = ip.split('.').map(Number);
        return !(
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0 && (c === 0 || c === 2)) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113) ||
            (a === 100 && b >= 64 && b <= 127)
        );
    }
    if (isIP(ip) !== 6) return false;
    const address = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    return /^(2|3)[0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|2|1[0-9a-f]|2[0-9a-f]):/i.test(address);
}

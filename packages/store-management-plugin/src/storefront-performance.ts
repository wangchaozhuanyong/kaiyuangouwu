import type { Request } from 'express';

import { trustedPublicPageHeaders } from './storefront-public-request';

const metricNames = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'] as const;
const phaseNames = ['ttfb', 'resourceLoadDelay', 'resourceLoadDuration', 'elementRenderDelay'] as const;
type MetricName = (typeof metricNames)[number];
type PhaseName = (typeof phaseNames)[number];
export interface PublicPerformanceBatch {
    sampleId: string;
    revision: string;
    pageType: string;
    device: string;
    network: string;
    metrics: Array<{ name: MetricName; value: number; phases?: Partial<Record<PhaseName, number>> }>;
}
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid telemetry');
    return value as Record<string, unknown>;
};
const only = (value: Record<string, unknown>, keys: readonly string[]) => {
    if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unexpected telemetry fields');
};
const choice = (value: unknown, options: readonly string[]): string => {
    if (typeof value !== 'string' || !options.includes(value)) throw new Error('Invalid telemetry category');
    return value;
};
const number = (value: unknown, max = 120_000): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
        throw new Error('Invalid telemetry value');
    return value;
};

/** No URL, element, visitor identifier, browser string or credential is accepted or logged. */
export function parsePublicPerformanceBatch(value: unknown): PublicPerformanceBatch {
    const raw = object(value);
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 8192) throw new Error('Telemetry too large');
    only(raw, ['sampleId', 'revision', 'pageType', 'device', 'network', 'metrics']);
    if (
        typeof raw.sampleId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(raw.sampleId)
    )
        throw new Error('Invalid telemetry sample');
    if (typeof raw.revision !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(raw.revision))
        throw new Error('Invalid telemetry revision');
    if (!Array.isArray(raw.metrics) || raw.metrics.length < 1 || raw.metrics.length > 5)
        throw new Error('Invalid telemetry batch');
    return {
        sampleId: raw.sampleId,
        revision: raw.revision,
        pageType: choice(raw.pageType, ['home', 'catalog', 'search', 'product', 'other']),
        device: choice(raw.device, ['mobile', 'desktop']),
        network: choice(raw.network, ['4g', '3g', '2g', 'slow-2g', 'unknown']),
        metrics: raw.metrics.map(metricValue => {
            const metric = object(metricValue);
            only(metric, ['name', 'value', 'phases']);
            const name = choice(metric.name, metricNames) as MetricName;
            const result: PublicPerformanceBatch['metrics'][number] = {
                name,
                value: number(metric.value, name === 'CLS' ? 100 : 120_000),
            };
            if (metric.phases != null) {
                const phases = object(metric.phases);
                only(phases, phaseNames);
                result.phases = Object.fromEntries(
                    Object.entries(phases).map(([key, phaseValue]) => [key, number(phaseValue)]),
                );
            }
            return result;
        }),
    };
}

export function publicPerformanceRegion(req: Request): 'CN' | 'MY' | 'OTHER' | 'UNKNOWN' {
    if (!trustedPublicPageHeaders(req) || req.headers['x-storefront-country-verified'] !== '1')
        return 'UNKNOWN';
    const country = req.headers['x-storefront-country'];
    if (typeof country !== 'string' || !/^[A-Z]{2}$/u.test(country) || country === 'XX') return 'UNKNOWN';
    return country === 'CN' || country === 'MY' ? country : 'OTHER';
}

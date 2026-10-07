import type { Metric } from 'web-vitals';
import type { LCPMetricWithAttribution } from 'web-vitals/attribution';

import { storefrontTrafficOptedOut, TRAFFIC_PREFERENCE_EVENT } from './storefront-traffic';

export function performancePageType(path: string): 'home' | 'catalog' | 'search' | 'product' | 'other' {
    if (path === '/' || path === '/home') return 'home';
    if (path === '/category') return 'catalog';
    if (path === '/search') return 'search';
    if (path === '/product') return 'product';
    return 'other';
}

export function performanceMetricPayload(metric: Metric | LCPMetricWithAttribution) {
    if (
        !['LCP', 'INP', 'CLS', 'TTFB', 'FCP'].includes(metric.name) ||
        !Number.isFinite(metric.value) ||
        metric.value < 0
    )
        return;
    const value = Math.min(metric.name === 'CLS' ? 100 : 120_000, metric.value);
    const result: { name: string; value: number; phases?: Record<string, number> } = {
        name: metric.name,
        value,
    };
    if (metric.name === 'LCP' && 'attribution' in metric) {
        const a = metric.attribution;
        result.phases = {
            ttfb: a.timeToFirstByte,
            resourceLoadDelay: a.resourceLoadDelay,
            resourceLoadDuration: a.resourceLoadDuration,
            elementRenderDelay: a.elementRenderDelay,
        };
        for (const key of Object.keys(result.phases)) {
            const phaseValue = result.phases[key];
            if (!Number.isFinite(phaseValue) || phaseValue < 0) delete result.phases[key];
            else result.phases[key] = Math.min(120_000, phaseValue);
        }
    }
    return result;
}

/** Deferred, consent-aware first-party CWV. Never send URLs, selectors, IDs, account or form data. */
export function observeStorefrontPerformance(): void {
    if (new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1') return;
    const sampleId = crypto.randomUUID();
    const pageType = performancePageType(location.pathname);
    const entry = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type=module][src]'))
        .map(script => new URL(script.src).pathname)
        .find(path => /\/(?:index|main)-[^/]+\.js$/u.test(path));
    const revision = entry?.split('/').at(-1)?.replace(/\.js$/u, '') ?? 'local-development';
    const device = matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const effectiveType = connection?.effectiveType ?? '';
    const network = ['4g', '3g', '2g', 'slow-2g'].includes(effectiveType) ? effectiveType : 'unknown';
    let started = false;
    const pending = new Map<string, NonNullable<ReturnType<typeof performanceMetricPayload>>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
        clearTimeout(timer);
        if (storefrontTrafficOptedOut()) {
            pending.clear();
            return;
        }
        if (!pending.size) return;
        const metrics = [...pending.values()].slice(0, 5);
        pending.clear();
        // A failed telemetry read never delays navigation or gets retried as a business operation.
        void fetch('/_storefront/performance', {
            method: 'POST',
            credentials: 'omit',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sampleId, revision, pageType, device, network, metrics }),
        }).catch(() => undefined);
    };
    const report = (metric: Metric | LCPMetricWithAttribution) => {
        if (storefrontTrafficOptedOut()) return;
        const safe = performanceMetricPayload(metric);
        if (!safe) return;
        pending.set(metric.name, safe);
        clearTimeout(timer);
        timer = setTimeout(flush, 1000);
    };
    const start = () => {
        if (storefrontTrafficOptedOut() || started) return;
        started = true;
        void import('web-vitals/attribution')
            .then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
                onCLS(report);
                onFCP(report);
                onINP(report);
                onLCP(report);
                onTTFB(report);
            })
            .catch(() => {
                started = false;
            });
    };
    window.addEventListener(TRAFFIC_PREFERENCE_EVENT, start);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    start();
}

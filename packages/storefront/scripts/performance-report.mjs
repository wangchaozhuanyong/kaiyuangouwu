/** Usage: node scripts/performance-report.mjs /absolute/path/to/anonymous-performance.log */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const threshold = { LCP: 2500, INP: 200, CLS: 0.1 };
const metricNames = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'];
const phaseNames = ['ttfb', 'resourceLoadDelay', 'resourceLoadDuration', 'elementRenderDelay'];
const effectiveTypes = ['4g', '3g', '2g', 'slow-2g'];
const minimumSamples = 20;

function percentile75(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * 0.75) - 1];
}

function validValue(value, maximum = 120_000) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

/** Input order is log arrival order; a later metric update replaces that page sample's earlier value. */
export function performanceReport(log) {
    const latest = new Map();
    for (const line of log.split('\n')) {
        const start = line.indexOf('{');
        if (start < 0) continue;
        let sample;
        try {
            sample = JSON.parse(line.slice(start));
        } catch {
            continue;
        }
        if (
            !sample ||
            sample.event !== 'storefront-performance' ||
            !['sampleId', 'revision', 'store'].every(
                key => typeof sample[key] === 'string' && sample[key].length > 0,
            ) ||
            !Array.isArray(sample.metrics)
        )
            continue;
        for (const metric of sample.metrics) {
            if (
                !metric ||
                !metricNames.includes(metric.name) ||
                !validValue(metric.value, metric.name === 'CLS' ? 100 : 120_000)
            )
                continue;
            // Revision/store isolate independent reports, even if imported logs reuse a sample ID.
            const key = JSON.stringify([sample.revision, sample.store, sample.sampleId, metric.name]);
            latest.set(key, {
                revision: sample.revision,
                store: sample.store,
                region: ['CN', 'MY', 'OTHER'].includes(sample.region) ? sample.region : 'UNKNOWN',
                device: ['mobile', 'desktop'].includes(sample.device) ? sample.device : 'unknown',
                network: effectiveTypes.includes(sample.network) ? sample.network : 'unknown',
                pageType: ['home', 'catalog', 'search', 'product', 'other'].includes(sample.pageType)
                    ? sample.pageType
                    : 'unknown',
                metric,
            });
        }
    }
    const groups = new Map();
    for (const sample of latest.values()) {
        const key = JSON.stringify([
            sample.revision,
            sample.store,
            sample.region,
            sample.device,
            sample.network,
            sample.pageType,
            sample.metric.name,
        ]);
        const metrics = groups.get(key) ?? [];
        metrics.push(sample.metric);
        groups.set(key, metrics);
    }
    const output = [...groups].map(([key, metrics]) => {
        const [revision, store, region, device, network, pageType, metric] = JSON.parse(key);
        const p75 = percentile75(metrics.map(item => item.value));
        const blockers = [
            ...(metrics.length < minimumSamples ? ['INSUFFICIENT_SAMPLES'] : []),
            ...(region === 'UNKNOWN' ? ['REGION_UNVERIFIED'] : []),
            ...(network === 'unknown' ? ['NETWORK_UNVERIFIED'] : []),
            ...(device === 'unknown' ? ['DEVICE_UNVERIFIED'] : []),
            ...(pageType === 'unknown' ? ['PAGE_UNVERIFIED'] : []),
        ];
        const lcpPhases =
            metric === 'LCP'
                ? Object.fromEntries(
                      phaseNames.map(name => {
                          const values = metrics
                              .map(item => item.phases?.[name])
                              .filter(value => validValue(value));
                          return [name, { samples: values.length, p75: percentile75(values), unit: 'ms' }];
                      }),
                  )
                : undefined;
        return {
            revision,
            store,
            region,
            device,
            network,
            pageType,
            metric,
            samples: metrics.length,
            p75,
            unit: metric === 'CLS' ? 'score' : 'ms',
            networkEvidence: network === 'unknown' ? 'UNAVAILABLE' : 'NAVIGATOR_EFFECTIVE_TYPE',
            physicalNetwork: 'NOT_VERIFIED',
            targetNetworkAcceptance: 'NOT_VERIFIED',
            blockers,
            status:
                blockers[0] ??
                (threshold[metric] === undefined ? 'MEASURED' : p75 <= threshold[metric] ? 'PASS' : 'FAIL'),
            ...(lcpPhases ? { lcpPhases } : {}),
        };
    });
    return {
        source: 'field',
        minimumSamples,
        statusScope:
            'Metric threshold within each observed effective-network group; not physical-network acceptance.',
        targetNetworkAcceptance: 'NOT_VERIFIED',
        groups: output,
        networkNote:
            'network is navigator.connection.effectiveType: a browser-estimated effective connection grade. ' +
            'The label 4g does not prove cellular 4G; it may also describe Wi-Fi or fixed broadband. ' +
            'Physical connection type, carrier and actual CN/MY 4G/broadband test conditions are NOT_VERIFIED.',
        note:
            'Never combine revisions/stores/regions/devices/effective-network grades/pages. ' +
            'Fewer than 20 unique metric samples, unknown region or unknown network cannot PASS. ' +
            'Synthetic measurements require a separate report. LCP phase p75 values are diagnostic only: ' +
            'their individual sample counts may differ, and their sum is not total LCP p75.',
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const input = process.argv[2];
    if (!input) throw new Error('Provide the anonymous storefront-performance JSONL log path');
    process.stdout.write(JSON.stringify(performanceReport(await readFile(input, 'utf8')), null, 2) + '\n');
}

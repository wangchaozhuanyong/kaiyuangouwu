import assert from 'node:assert/strict';
import { test } from 'node:test';

import { performanceReport } from './performance-report.mjs';

const sample = (index, fields = {}, metric = {}) => ({
    event: 'storefront-performance',
    sampleId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    revision: 'index-qa',
    store: 'fixture-store',
    region: 'MY',
    device: 'mobile',
    network: '4g',
    pageType: 'catalog',
    metrics: [{ name: 'LCP', value: 1800, ...metric }],
    ...fields,
});
const report = samples => performanceReport(samples.map(value => JSON.stringify(value)).join('\n'));

test('a repeated sample updates its metric and phases without inflating the sample count', () => {
    const result = report([
        sample(1, {}, { value: 1000, phases: { ttfb: 100, resourceLoadDelay: 200 } }),
        sample(1, { metrics: [{ name: 'INP', value: 70 }] }),
        sample(1, {}, { value: 3000, phases: { ttfb: 400 } }),
    ]);
    const lcp = result.groups.find(group => group.metric === 'LCP');
    assert.equal(lcp.samples, 1);
    assert.equal(lcp.p75, 3000);
    assert.deepEqual(lcp.lcpPhases.ttfb, { samples: 1, p75: 400, unit: 'ms' });
    assert.deepEqual(lcp.lcpPhases.resourceLoadDelay, { samples: 0, p75: null, unit: 'ms' });
    assert.equal(result.groups.find(group => group.metric === 'INP').p75, 70);
});

test('19 unique observations plus repeated updates cannot reach the 20-sample PASS gate', () => {
    const observations = Array.from({ length: 19 }, (_, index) => sample(index));
    const result = report([...observations, ...Array.from({ length: 10 }, () => sample(1))]);
    assert.equal(result.groups[0].samples, 19);
    assert.equal(result.groups[0].status, 'INSUFFICIENT_SAMPLES');
    assert.equal(report([...observations, sample(19)]).groups[0].status, 'PASS');
});

test('unknown, missing or invalid regions cannot PASS even with enough fast samples', () => {
    for (const region of ['UNKNOWN', undefined, 'unverified-country']) {
        const group = report(Array.from({ length: 20 }, (_, index) => sample(index, { region }))).groups[0];
        assert.equal(group.region, 'UNKNOWN');
        assert.equal(group.status, 'REGION_UNVERIFIED');
    }
});

test('unknown effective network cannot PASS; 4g classification never verifies physical 4G or broadband', () => {
    for (const network of ['unknown', undefined, 'wifi']) {
        const group = report(Array.from({ length: 20 }, (_, index) => sample(index, { network }))).groups[0];
        assert.equal(group.network, 'unknown');
        assert.equal(group.networkEvidence, 'UNAVAILABLE');
        assert.equal(group.status, 'NETWORK_UNVERIFIED');
    }
    const result = report(Array.from({ length: 20 }, (_, index) => sample(index)));
    assert.equal(result.groups[0].network, '4g');
    assert.equal(result.groups[0].networkEvidence, 'NAVIGATOR_EFFECTIVE_TYPE');
    assert.equal(result.groups[0].physicalNetwork, 'NOT_VERIFIED');
    assert.equal(result.groups[0].targetNetworkAcceptance, 'NOT_VERIFIED');
    assert.equal(result.targetNetworkAcceptance, 'NOT_VERIFIED');
    assert.match(result.networkNote, /does not prove cellular 4G/u);
    assert.match(result.networkNote, /Wi-Fi or fixed broadband/u);
});

test('regions, devices, pages, grades, revisions and stores retain independent groups', () => {
    const observations = [sample(1)];
    for (const fields of [
        { region: 'CN' },
        { device: 'desktop' },
        { pageType: 'product' },
        { network: '3g' },
    ])
        observations.push(sample(observations.length + 1, fields));
    // A log import reusing the same ID must not overwrite another deployment/store.
    observations.push(sample(1, { revision: 'index-new' }), sample(1, { store: 'fixture-store-2' }));
    const result = report(observations);
    assert.equal(result.groups.length, 7);
    assert.ok(result.groups.every(group => group.samples === 1 && group.status === 'INSUFFICIENT_SAMPLES'));
});

test('LCP phase p75 uses each available finite phase without turning missing attribution into zero', () => {
    const result = report(
        Array.from({ length: 20 }, (_, index) =>
            sample(
                index,
                {},
                {
                    value: 1000 + index * 100,
                    phases: {
                        ttfb: index * 10,
                        resourceLoadDelay: index < 4 ? index * 100 : undefined,
                        resourceLoadDuration: -1,
                        elementRenderDelay: index === 0 ? 120_001 : null,
                    },
                },
            ),
        ),
    );
    const group = result.groups[0];
    assert.equal(group.p75, 2400);
    assert.deepEqual(group.lcpPhases.ttfb, { samples: 20, p75: 140, unit: 'ms' });
    assert.deepEqual(group.lcpPhases.resourceLoadDelay, { samples: 4, p75: 200, unit: 'ms' });
    assert.deepEqual(group.lcpPhases.resourceLoadDuration, { samples: 0, p75: null, unit: 'ms' });
    assert.deepEqual(group.lcpPhases.elementRenderDelay, { samples: 0, p75: null, unit: 'ms' });
});

test('invalid telemetry is ignored and independently reported metrics keep their thresholds', () => {
    const lines = [
        'not json',
        '{bad json',
        JSON.stringify({ event: 'unrelated', sampleId: 'unused', metrics: [] }),
        JSON.stringify(
            sample(1, { metrics: [null, { name: 'unexpected', value: 0 }, { name: 'LCP', value: -1 }] }),
        ),
        ...Array.from(
            { length: 20 },
            (_, index) =>
                'info [StorefrontPerformance] ' +
                JSON.stringify(
                    sample(index, {
                        metrics: [
                            { name: 'LCP', value: 2600 },
                            { name: 'CLS', value: 0.12 },
                            { name: 'TTFB', value: 100 },
                        ],
                    }),
                ),
        ),
    ];
    const result = performanceReport(lines.join('\n'));
    assert.equal(result.groups.length, 3);
    assert.equal(result.groups.find(group => group.metric === 'LCP').status, 'FAIL');
    assert.equal(result.groups.find(group => group.metric === 'CLS').status, 'FAIL');
    assert.equal(result.groups.find(group => group.metric === 'CLS').unit, 'score');
    assert.equal(result.groups.find(group => group.metric === 'TTFB').status, 'MEASURED');
});

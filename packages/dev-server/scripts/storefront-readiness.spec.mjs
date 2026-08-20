import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateStorefrontReadiness,
    isAllowedAuditOrigin,
    parseTaxPolicy,
} from './storefront-readiness.mjs';

function product(overrides = {}) {
    return {
        id: '1',
        name: 'Production product',
        description: 'Approved product content',
        enabled: true,
        featuredAsset: { id: 'asset-1' },
        translations: [
            { languageCode: 'en', name: 'Production product' },
            { languageCode: 'zh_Hans', name: '正式商品' },
        ],
        variants: [
            {
                name: 'Standard',
                sku: 'PROD-001',
                enabled: true,
                price: 1000,
                currencyCode: 'CNY',
                taxCategory: { id: 'standard-tax', name: 'Standard Tax' },
                translations: [
                    { languageCode: 'en', name: 'Standard' },
                    { languageCode: 'zh_Hans', name: '标准版' },
                ],
                customFields: { fulfillmentType: 'physical' },
            },
        ],
        ...overrides,
    };
}

function channel(code, overrides = {}) {
    const isChina = code === 'cn-mainland';
    const countryCode = isChina ? 'CN' : 'MY';
    const currencyCode = isChina ? 'CNY' : 'MYR';
    return {
        id: isChina ? '2' : '3',
        code,
        defaultLanguageCode: isChina ? 'zh_Hans' : 'en',
        defaultCurrencyCode: currencyCode,
        pricesIncludeTax: false,
        defaultTaxZone: {
            id: `${String(countryCode)}-tax`,
            name: `${String(countryCode)} tax`,
            members: [{ code: countryCode }],
        },
        defaultShippingZone: {
            id: `${String(countryCode)}-shipping`,
            name: `${String(countryCode)} shipping`,
            members: [{ code: countryCode }],
        },
        domains: [{ domain: `${String(code)}.example.com`, isPrimary: true, status: 'ACTIVE' }],
        paymentMethods: [
            {
                code: `${String(code)}-card`,
                name: 'Card',
                description: 'Card payment',
                enabled: true,
                handler: { code: 'stripe-payment-handler' },
            },
        ],
        shippingMethods: [
            { code: `${String(code)}-delivery`, name: 'Delivery', description: 'Approved delivery' },
        ],
        taxRates: [
            {
                name: `${String(code)} standard tax`,
                enabled: true,
                value: 0,
                zone: { id: `${String(countryCode)}-tax`, name: `${String(countryCode)} tax` },
                category: { id: 'standard-tax', name: 'Standard Tax' },
                customerGroup: null,
            },
        ],
        products: [product({ variants: [{ ...product().variants[0], currencyCode }] })],
        contentBlocks: [
            {
                code: 'primary-hero',
                translations: [
                    { languageCode: 'en', title: 'Store' },
                    { languageCode: 'zh_Hans', title: '商城' },
                ],
                items: [],
            },
        ],
        ...overrides,
    };
}

function readySnapshot() {
    return {
        configuration: { routingMode: 'require-domain', cnameTarget: 'stores.example.com' },
        demoAssetCount: 0,
        pendingSearchIndexUpdates: 0,
        activeSearchIndexJobs: 0,
        channels: [channel('cn-mainland'), channel('my-malaysia')],
    };
}

const approvedTaxPolicy = {
    'cn-mainland': { pricesIncludeTax: false, rates: { 'Standard Tax': 0 } },
    'my-malaysia': { pricesIncludeTax: false, rates: { 'Standard Tax': 0 } },
};

void test('accepts HTTPS targets and local HTTP only', () => {
    assert.equal(isAllowedAuditOrigin('https://shop.example.com'), true);
    assert.equal(isAllowedAuditOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isAllowedAuditOrigin('https://vendure.localhost:1355'), true);
    assert.equal(isAllowedAuditOrigin('http://shop.example.com'), false);
});

void test('parses an explicit approved tax policy', () => {
    assert.deepEqual(parseTaxPolicy(JSON.stringify(approvedTaxPolicy)), approvedTaxPolicy);
    assert.throws(() => parseTaxPolicy('{"cn-mainland":{}}'), /pricesIncludeTax as a boolean/);
    assert.throws(
        () => parseTaxPolicy('{"cn-mainland":{"pricesIncludeTax":false,"rates":{"Standard":120}}}'),
        /between 0 and 100/,
    );
});

void test('passes a complete production snapshot', () => {
    const report = evaluateStorefrontReadiness(readySnapshot(), approvedTaxPolicy);
    assert.equal(report.ready, true);
    assert.equal(report.summary.blocker, 0);
    assert.equal(report.summary.manual, 0);
});

void test('reports demo data, test payment, bad zones and missing domains', () => {
    const snapshot = readySnapshot();
    snapshot.configuration = { routingMode: 'prefer-domain', cnameTarget: 'vendure.localhost' };
    snapshot.demoAssetCount = 4;
    snapshot.channels[1] = channel('my-malaysia', {
        defaultTaxZone: { id: 'CN-tax', name: 'China', members: [{ code: 'CN' }] },
        defaultShippingZone: { id: 'CN-shipping', name: 'China', members: [{ code: 'CN' }] },
        domains: [],
        paymentMethods: [
            {
                code: '测试支付',
                name: '测试支付',
                enabled: true,
                handler: { code: 'dummy-payment-handler' },
            },
        ],
        products: [
            product({
                name: '临时演示商品',
                variants: [{ ...product().variants[0], sku: 'DEMO-001', currencyCode: 'MYR' }],
            }),
        ],
        shippingMethods: [{ code: '标准配送', name: '标准配送', description: '' }],
        contentBlocks: [{ code: 'demo-primary-hero', translations: [], items: [] }],
    });
    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);
    const failedIds = new Set(
        report.checks.filter(check => check.status === 'blocker').map(check => check.id),
    );
    assert.equal(report.ready, false);
    assert.ok(failedIds.has('domain-routing-mode'));
    assert.ok(failedIds.has('public-cname-target'));
    assert.ok(failedIds.has('demo-assets'));
    assert.ok(failedIds.has('tax-zone-my-malaysia'));
    assert.ok(failedIds.has('tax-rate-coverage-my-malaysia'));
    assert.ok(failedIds.has('shipping-zone-my-malaysia'));
    assert.ok(failedIds.has('primary-domain-my-malaysia'));
    assert.ok(failedIds.has('payments-my-malaysia'));
    assert.ok(failedIds.has('shipping-methods-my-malaysia'));
    assert.ok(failedIds.has('products-real-my-malaysia'));
    assert.ok(failedIds.has('content-real-my-malaysia'));
    assert.ok(failedIds.has('market-tax-zone-separation'));
});

void test('keeps tax mode approval as an explicit manual gate', () => {
    const report = evaluateStorefrontReadiness(readySnapshot());
    assert.equal(report.ready, false);
    assert.equal(report.summary.manual, 4);
});

void test('blocks an enabled but unapproved tax rate', () => {
    const snapshot = readySnapshot();
    snapshot.channels[1].taxRates[0].value = 20;
    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

    assert.equal(
        report.checks.find(check => check.id === 'tax-rates-approved-my-malaysia')?.status,
        'blocker',
    );
});

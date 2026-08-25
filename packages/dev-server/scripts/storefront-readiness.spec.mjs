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
        featuredAsset: { id: 'asset-1', tags: [] },
        assets: [],
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
                featuredAsset: null,
                assets: [],
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
    const countryCode = 'MY';
    const currencyCode = 'MYR';
    return {
        id: '3',
        code,
        defaultLanguageCode: 'en',
        availableLanguageCodes: ['en', 'zh_Hans'],
        defaultCurrencyCode: currencyCode,
        availableCurrencyCodes: [currencyCode],
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
            {
                code: `${String(code)}-delivery`,
                name: 'Delivery',
                description: 'Approved delivery',
                checker: { code: 'supported-destination-eligibility-checker', args: [] },
            },
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
        availableCountryCodes: ['MY', 'SG', 'US'],
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
        couponCampaigns: [],
        ...overrides,
    };
}

function readySnapshot() {
    return {
        configuration: { routingMode: 'require-domain', cnameTarget: 'stores.example.com' },
        pendingSearchIndexUpdates: 0,
        activeSearchIndexJobs: 0,
        storefrontChannelCodes: ['my-malaysia'],
        channels: [channel('my-malaysia')],
    };
}

const approvedTaxPolicy = {
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
    snapshot.channels[0] = channel('my-malaysia', {
        defaultTaxZone: { id: 'tax-zone', name: 'Tax zone', members: [] },
        defaultShippingZone: { id: 'shipping-zone', name: 'Shipping zone', members: [] },
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
    assert.ok(failedIds.has('tax-zone-my-malaysia'));
    assert.ok(failedIds.has('tax-rate-coverage-my-malaysia'));
    assert.ok(failedIds.has('shipping-zone-my-malaysia'));
    assert.ok(failedIds.has('primary-domain-my-malaysia'));
    assert.ok(failedIds.has('payments-my-malaysia'));
    assert.ok(failedIds.has('shipping-methods-my-malaysia'));
    assert.ok(failedIds.has('products-real-my-malaysia'));
    assert.ok(failedIds.has('content-real-my-malaysia'));
});

void test('blocks demo-tagged assets only when the live catalog references them', () => {
    const snapshot = readySnapshot();
    snapshot.channels[0].products = [
        product({
            featuredAsset: {
                id: 'asset-1',
                tags: [{ value: 'storefront-demo' }],
            },
            variants: [{ ...product().variants[0], currencyCode: 'MYR' }],
        }),
    ];
    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

    assert.equal(report.checks.find(check => check.id === 'products-real-my-malaysia')?.status, 'blocker');
});

void test('blocks enabled test coupons, no-op rates and discount labels that disagree with configuration', () => {
    const invalidCampaigns = [
        {
            name: '订单九折',
            couponCode: 'AUDIT-20260820',
            kind: 'ORDER_PERCENTAGE',
            enabled: true,
            startsAt: null,
            endsAt: null,
            minimumSpend: 0,
            discountAmount: null,
            discountRate: 9,
        },
        {
            name: '无效折扣',
            couponCode: 'LIVE10',
            kind: 'ORDER_PERCENTAGE',
            enabled: true,
            startsAt: null,
            endsAt: null,
            minimumSpend: 0,
            discountAmount: null,
            discountRate: 10,
        },
        {
            name: '订单九折',
            couponCode: 'LIVE80',
            kind: 'ORDER_PERCENTAGE',
            enabled: true,
            startsAt: null,
            endsAt: null,
            minimumSpend: 0,
            discountAmount: null,
            discountRate: 8,
        },
    ];

    for (const campaign of invalidCampaigns) {
        const snapshot = readySnapshot();
        snapshot.channels[0].couponCampaigns = [campaign];
        const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

        assert.equal(
            report.checks.find(check => check.id === 'coupon-campaigns-my-malaysia')?.status,
            'blocker',
            campaign.couponCode,
        );
    }
});

void test('keeps tax mode approval as an explicit manual gate', () => {
    const report = evaluateStorefrontReadiness(readySnapshot());
    assert.equal(report.ready, false);
    assert.equal(report.summary.manual, 2);
});

void test('does not require tax configuration when taxation is disabled', () => {
    const snapshot = readySnapshot();
    snapshot.channels[0].defaultTaxZone = null;
    snapshot.channels[0].taxRates = [];
    const report = evaluateStorefrontReadiness(snapshot);
    const taxChecks = report.checks.filter(check => check.id.startsWith('tax-'));

    assert.equal(report.ready, true);
    assert.equal(taxChecks.length, 0);
});

void test('blocks an enabled but unapproved tax rate', () => {
    const snapshot = readySnapshot();
    snapshot.channels[0].taxRates[0].value = 20;
    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

    assert.equal(
        report.checks.find(check => check.id === 'tax-rates-approved-my-malaysia')?.status,
        'blocker',
    );
});

void test('does not require a hard-coded regional Channel for a global independent storefront', () => {
    const report = evaluateStorefrontReadiness(readySnapshot(), approvedTaxPolicy);
    const ids = new Set(report.checks.map(check => check.id));

    assert.equal(report.ready, true);
    assert.equal(ids.has('channel-cn-mainland'), false);
    assert.equal(ids.has('market-tax-zone-separation'), false);
    assert.equal(
        report.checks.find(check => check.id === 'global-country-availability-my-malaysia')?.status,
        'pass',
    );
});

void test('allows global digital sales even when the physical shipping method is regional', () => {
    const snapshot = readySnapshot();
    snapshot.channels[0].products[0].variants[0].customFields.fulfillmentType = 'digital';
    snapshot.channels[0].shippingMethods[0].checker.args = [{ name: 'allowedCountryCodes', value: 'MY' }];

    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

    assert.equal(
        report.checks.find(check => check.id === 'global-physical-shipping-my-malaysia')?.status,
        'pass',
    );
});

void test('blocks a global physical catalog when shipping remains regional', () => {
    const snapshot = readySnapshot();
    snapshot.channels[0].shippingMethods[0].checker.args = [{ name: 'allowedCountryCodes', value: 'MY' }];

    const report = evaluateStorefrontReadiness(snapshot, approvedTaxPolicy);

    assert.equal(
        report.checks.find(check => check.id === 'global-physical-shipping-my-malaysia')?.status,
        'blocker',
    );
});

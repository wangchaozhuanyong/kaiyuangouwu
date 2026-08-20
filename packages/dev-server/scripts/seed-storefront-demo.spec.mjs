import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import {
    createUploadMap,
    demoCollections,
    demoInventoryTracking,
    demoProducts,
    isLocalApiOrigin,
    validateDemoCollections,
    validateDemoProducts,
} from './seed-storefront-demo.mjs';

void test('accepts only local API origins', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost:1355'), true);
    assert.equal(isLocalApiOrigin('https://example.com'), false);
    assert.equal(isLocalApiOrigin('not-a-url'), false);
});

void test('digital demos match delivery assets and do not track inventory', () => {
    const digitalProducts = demoProducts.filter(product => product.fulfillmentType === 'digital');
    assert.deepEqual(digitalProducts.map(product => product.sku).sort(), [
        'DEMO-DIGITAL-AI-STARTER',
        'DEMO-DIGITAL-ECOMMERCE',
        'DEMO-DIGITAL-PROMPTS',
        'DEMO-DIGITAL-SUPPORT',
        'DEMO-DIGITAL-VIDEO',
    ]);
    for (const product of digitalProducts) {
        assert.equal(demoInventoryTracking(product), 'FALSE');
        assert.equal(
            existsSync(new URL(`../digital-delivery-assets/${product.sku}.txt`, import.meta.url)),
            true,
        );
    }
});

void test('demo products have unique bilingual identifiers and regional prices', () => {
    assert.equal(validateDemoProducts(demoProducts), true);
    assert.equal(new Set(demoProducts.map(product => product.sku)).size, demoProducts.length);
    assert.ok(demoProducts.every(product => product.product.en.name && product.product.zh.name));
});

void test('rejects duplicate demo SKUs', () => {
    assert.throws(() => validateDemoProducts([demoProducts[0], demoProducts[0]]), /Duplicate demo SKU/);
});

void test('demo collections are channel-specific, bilingual, and group shared products differently', () => {
    assert.equal(validateDemoCollections(demoCollections), true);
    assert.equal(new Set(demoCollections.map(collection => collection.code)).size, demoCollections.length);
    const cnGroups = demoCollections
        .filter(collection => collection.channelCode === 'cn-mainland')
        .map(collection => collection.productSkus.join(','));
    const myGroups = demoCollections
        .filter(collection => collection.channelCode === 'my-malaysia')
        .map(collection => collection.productSkus.join(','));
    assert.notDeepEqual(cnGroups, myGroups);
});

void test('uses the GraphQL multipart request map shape', () => {
    assert.deepEqual(createUploadMap('variables.input.0.file'), {
        0: ['variables.input.0.file'],
    });
});

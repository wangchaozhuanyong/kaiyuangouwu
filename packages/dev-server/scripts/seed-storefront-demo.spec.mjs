import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createUploadMap,
    demoProducts,
    isLocalApiOrigin,
    validateDemoProducts,
} from './seed-storefront-demo.mjs';

void test('accepts only local API origins', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost:1355'), true);
    assert.equal(isLocalApiOrigin('https://example.com'), false);
    assert.equal(isLocalApiOrigin('not-a-url'), false);
});

void test('demo products have unique bilingual identifiers and regional prices', () => {
    assert.equal(validateDemoProducts(demoProducts), true);
    assert.equal(new Set(demoProducts.map(product => product.sku)).size, demoProducts.length);
    assert.ok(demoProducts.every(product => product.product.en.name && product.product.zh.name));
});

void test('rejects duplicate demo SKUs', () => {
    assert.throws(() => validateDemoProducts([demoProducts[0], demoProducts[0]]), /Duplicate demo SKU/);
});

void test('uses the GraphQL multipart request map shape', () => {
    assert.deepEqual(createUploadMap('variables.input.0.file'), {
        0: ['variables.input.0.file'],
    });
});

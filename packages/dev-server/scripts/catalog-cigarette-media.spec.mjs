import assert from 'node:assert/strict';
import test from 'node:test';

import {
    catalogCigaretteMediaManifest,
    catalogCigaretteUnmatchedAssets,
} from './catalog-cigarette-media.mjs';

void test('cigarette Asset review covers every supplied image exactly once', () => {
    const mappedNames = catalogCigaretteMediaManifest.map(item => item.existingAsset.name);
    const unmatchedNames = catalogCigaretteUnmatchedAssets.map(item => item.name);
    const allNames = [...mappedNames, ...unmatchedNames];

    assert.equal(catalogCigaretteMediaManifest.length, 126);
    assert.equal(catalogCigaretteUnmatchedAssets.length, 7);
    assert.equal(allNames.length, 133);
    assert.equal(new Set(allNames).size, allNames.length);
});

void test('cigarette Asset bindings use stable unique keys and SKU targets', () => {
    const keys = catalogCigaretteMediaManifest.map(item => item.key);
    const skus = catalogCigaretteMediaManifest.flatMap(item => item.productSkus);

    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(skus).size, skus.length);
    assert.equal(skus.length, 255);
    for (const item of catalogCigaretteMediaManifest) {
        assert.equal(item.key, `catalog-cigarette-${item.productSkus[0].toLowerCase()}`);
        assert.match(item.existingAsset.sourceSha256, /^[a-f0-9]{64}$/u);
        assert.equal(item.existingAsset.width, 1254);
        assert.equal(item.existingAsset.height, 1254);
        assert.ok(item.productNames.length > 0);
    }
});

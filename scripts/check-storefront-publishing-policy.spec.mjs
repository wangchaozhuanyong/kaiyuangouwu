import assert from 'node:assert/strict';
import test from 'node:test';

import {
    auditStorefrontPublishingPolicy,
    findForbiddenClientMediaReferences,
    isDerivedResponsiveAsset,
} from './check-storefront-publishing-policy.mjs';

test('current storefront media inventory has an explicit publishing classification', async () => {
    const result = await auditStorefrontPublishingPolicy();
    assert.deepEqual(result.issues, []);
    assert.ok(result.inspectedMediaCount > 0);
    assert.ok(result.classifiedMediaCount > 0);
});

test('responsive derivatives are accepted only when their original is classified', () => {
    const classified = new Set(['packages/storefront/src/assets/storefront/hero.jpg']);
    assert.equal(
        isDerivedResponsiveAsset('packages/storefront/src/assets/storefront/hero-960.webp', classified),
        true,
    );
    assert.equal(
        isDerivedResponsiveAsset('packages/storefront/src/assets/storefront/unreviewed-960.webp', classified),
        false,
    );
});

test('client bypasses are rejected while tests may use fixture URLs', () => {
    assert.equal(
        findForbiddenClientMediaReferences(
            "import image from '../../dev-server/assets/referral-posters/v2/01-clear-blue.png';",
            'packages/storefront/src/home.tsx',
        ).length,
        1,
    );
    assert.equal(
        findForbiddenClientMediaReferences(
            "import image from './assets/storefront/new-banner.png';",
            'packages/storefront/src/home.tsx',
        ).length,
        1,
    );
    assert.equal(
        findForbiddenClientMediaReferences(
            "const image = 'https://cdn.example.com/new-banner.png';",
            'packages/storefront/src/home.tsx',
        ).length,
        1,
    );
    assert.deepEqual(
        findForbiddenClientMediaReferences(
            "const image = 'https://cdn.example.com/fixture.png';",
            'packages/storefront/src/home.spec.tsx',
        ),
        [],
    );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    auditStorefrontUnification,
    findStorefrontUnificationIssues,
} from './check-storefront-unification.mjs';

test('shared runtime has no store-specific brand defaults or code branches', async () => {
    const result = await auditStorefrontUnification();
    assert.deepEqual(result.issues, []);
    assert.ok(result.inspectedFiles > 0);
});

test('rejects hard-coded merchant brands and store-code UI branches', () => {
    assert.equal(
        findStorefrontUnificationIssues("const title = 'MOYAO AI';", 'packages/storefront/src/page.tsx')
            .length,
        1,
    );
    assert.equal(
        findStorefrontUnificationIssues(
            "if (market.code === 'my-shop') showBadge();",
            'packages/storefront/src/page.tsx',
        ).length,
        1,
    );
    assert.equal(
        findStorefrontUnificationIssues(
            'const preset = markets[config.code];',
            'packages/storefront/src/page.tsx',
        ).length,
        1,
    );
    assert.equal(
        findStorefrontUnificationIssues(
            "import hero from './assets/storefront/auth-login-ai-campaign-v2.webp';",
            'packages/storefront/src/page.tsx',
        ).length,
        1,
    );
    assert.deepEqual(
        findStorefrontUnificationIssues('const key = market.code;', 'packages/storefront/src/api.ts'),
        [],
    );
    assert.deepEqual(
        findStorefrontUnificationIssues(
            "if (channel.code === '__default_channel__') return;",
            'packages/next-admin/src/pages/Settings/Role.tsx',
        ),
        [],
    );
    assert.deepEqual(
        findStorefrontUnificationIssues(
            '<p>MOYAO AI｜模钥管理后台</p>',
            'packages/next-admin/src/pages/Auth/LoginModule.tsx',
        ),
        [],
    );
});

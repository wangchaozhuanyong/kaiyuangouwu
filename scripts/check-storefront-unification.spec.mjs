import assert from 'node:assert/strict';
import test from 'node:test';

import {
    auditStorefrontUnification,
    findRetiredStorefrontIssues,
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

test('permits the exact platform channel title while still rejecting merchant defaults in its shared helper', () => {
    const file = 'packages/next-admin/src/utils/channel-display.ts';
    assert.deepEqual(
        findStorefrontUnificationIssues(
            "return languageCode === 'zh_Hans' ? '模钥平台管理中心' : 'MOYAO Platform Management Center';",
            file,
        ),
        [],
    );
    assert.equal(findStorefrontUnificationIssues("return 'MOYAO AI';", file).length, 1);
    assert.equal(
        findStorefrontUnificationIssues(
            "return 'MOYAO Platform Management Center';",
            'packages/storefront/src/page.tsx',
        ).length,
        1,
    );
});

test('rejects restored retired helpers and account artwork, including CSS in a new file', () => {
    for (const source of [
        'export function desktopCategoryBannerInput() {}',
        'import { resolveDesktopCategoryBanner } from "./desktop-category-banner";',
    ]) {
        assert.equal(
            findRetiredStorefrontIssues(source, 'packages/storefront-content-plugin/src/new.ts').length,
            1,
        );
    }
    for (const source of [
        '.account-hero { background: orange; }',
        '.account-hero.has-custom-background .account-hero-art { display: block; }',
        '<div className="account-hero-art" />',
        '<div className="account-hero" />',
    ]) {
        assert.equal(findRetiredStorefrontIssues(source, 'packages/storefront/src/new.css').length, 1);
    }
    assert.deepEqual(
        findRetiredStorefrontIssues(
            'type Block = "ACCOUNT_HERO"; const purpose = "desktop-category-banner";',
            'packages/storefront-content-plugin/src/legacy-records.ts',
        ),
        [],
    );
    assert.deepEqual(
        findRetiredStorefrontIssues(
            '.account-profile-card { background: var(--account-hero-bg); }',
            'packages/storefront/src/styles/account.css',
        ),
        [],
    );
});

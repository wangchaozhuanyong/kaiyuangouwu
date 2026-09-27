import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyProductionReleaseImpact,
    inspectProductionReleaseImpact,
} from '../../../deploy/production-release-impact.mjs';

test('runtime-only releases reuse a recent verified backup and keep all-store acceptance', () => {
    const impact = classifyProductionReleaseImpact(['packages/next-admin/src/App.tsx']);

    assert.equal(impact.dataRisk, 'runtime-only');
    assert.equal(impact.backupPolicy, 'reuse-recent-or-create');
    assert.deepEqual(impact.affectedChecks, ['all-store-basics', 'dashboard']);
    assert.equal(impact.changedFileCount, 1);
    assert.match(impact.changedFilesSha256, /^[a-f0-9]{64}$/u);
});

test('schema releases always require a fresh backup and migration acceptance', () => {
    const impact = classifyProductionReleaseImpact([
        'packages/dev-server/migrations/1788706800000-release-usdt-historical-amount-keys.ts',
    ]);

    assert.equal(impact.dataRisk, 'schema');
    assert.equal(impact.backupPolicy, 'fresh');
    assert.ok(impact.affectedChecks.includes('database-migration'));
    assert.ok(impact.affectedChecks.includes('api'));
});

test('reviewed managed content writes require a fresh backup and explicit acceptance', () => {
    const impact = classifyProductionReleaseImpact(
        ['packages/storefront/src/assets/storefront/reviewed-home-hero.webp'],
        {
            mediaKeys: 'reviewed-home-hero-v1',
        },
    );

    assert.equal(impact.dataRisk, 'managed-content');
    assert.equal(impact.backupPolicy, 'fresh');
    assert.ok(impact.affectedChecks.includes('managed-content'));
    assert.ok(impact.affectedChecks.includes('storefront'));
});

test('realtime changes add the bounded public realtime acceptance', () => {
    const impact = classifyProductionReleaseImpact(['packages/storefront/src/realtime-updates.ts']);

    assert.ok(impact.affectedChecks.includes('storefront-realtime'));
});

test('a no-change release is rejected', () => {
    assert.throws(() => classifyProductionReleaseImpact([]), /at least one change/u);
});

test('managed storefront omissions fail before the expensive production build', () => {
    assert.throws(
        () =>
            classifyProductionReleaseImpact([
                'packages/storefront/src/assets/storefront/catalog-cigarettes/hero.webp',
            ]),
        /reviewed media keys are required/u,
    );
});

test('a code-only media publisher change does not authorize a content write', () => {
    const mediaScript = 'packages/dev-server/scripts/sync-storefront-media.mjs';
    const manifest = 'const scriptDirectory = "/assets";\nconst storefrontMediaManifest = [];\n';
    const source = code => `${manifest}const LOGIN_MUTATION = \`login\`;\n${code}`;
    const impact = inspectProductionReleaseImpact({
        baseSha: 'a'.repeat(40),
        targetSha: 'b'.repeat(40),
        releaseScope: {},
        git(_command, args) {
            if (args[0] === 'diff') return `${mediaScript}\n`;
            if (args[0] === 'show') return source(args[1].startsWith('a') ? 'old code' : 'new code');
            return '';
        },
    });

    assert.equal(impact.dataRisk, 'runtime-only');
    assert.ok(impact.affectedChecks.includes('api'));
    assert.ok(!impact.affectedChecks.includes('managed-content'));
});

test('a media manifest change still requires reviewed media keys', () => {
    const mediaScript = 'packages/dev-server/scripts/sync-storefront-media.mjs';
    assert.throws(
        () =>
            inspectProductionReleaseImpact({
                baseSha: 'a'.repeat(40),
                targetSha: 'b'.repeat(40),
                releaseScope: {},
                git(_command, args) {
                    if (args[0] === 'diff') return `${mediaScript}\n`;
                    if (args[0] === 'show') {
                        const key = args[1].startsWith('a') ? 'old' : 'new';
                        return `const scriptDirectory = "/assets";\nconst manifest = ["${key}"];\nconst LOGIN_MUTATION = \`login\`;\n`;
                    }
                    return '';
                },
            }),
        /reviewed media keys are required/u,
    );
});

test('a media publisher with unrecognized manifest boundaries is rejected', () => {
    const mediaScript = 'packages/dev-server/scripts/sync-storefront-media.mjs';
    assert.throws(
        () =>
            inspectProductionReleaseImpact({
                baseSha: 'a'.repeat(40),
                targetSha: 'b'.repeat(40),
                releaseScope: {},
                git(_command, args) {
                    if (args[0] === 'diff') return `${mediaScript}\n`;
                    if (args[0] === 'show') return 'export const storefrontMediaManifest = [];\n';
                    return '';
                },
            }),
        /Cannot isolate the storefront media manifest/u,
    );
});

test('managed scope cannot be attached to an unrelated runtime release', () => {
    assert.throws(
        () =>
            classifyProductionReleaseImpact(['packages/core/src/api/common/error/error-result.ts'], {
                authVisuals: true,
            }),
        /selected without a matching change/u,
    );
});

test('Git impact inspection includes deletions in the reviewed risk boundary', () => {
    const calls = [];
    const impact = inspectProductionReleaseImpact({
        baseSha: 'a'.repeat(40),
        targetSha: 'b'.repeat(40),
        releaseScope: {},
        git(command, args) {
            calls.push([command, ...args]);
            return args[0] === 'diff' ? 'packages/dev-server/migrations/1788706800000-removed.ts\n' : '';
        },
    });

    assert.equal(impact.dataRisk, 'schema');
    assert.ok(calls.some(call => call.includes('--diff-filter=ACDMRT')));
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    classifyProductionReleaseImpact,
    inspectProductionReleaseImpact,
} from '../../../deploy/production-release-impact.mjs';

const posterPresetsPath = 'packages/store-management-plugin/src/referral/referral-poster-presets.ts';
const posterPresetsSource = readFileSync(
    new URL('../../store-management-plugin/src/referral/referral-poster-presets.ts', import.meta.url),
    'utf8',
);
function inspectPosterChange(targetSource, releaseScope = {}) {
    return inspectProductionReleaseImpact({
        baseSha: 'a'.repeat(40),
        targetSha: 'b'.repeat(40),
        releaseScope,
        git(_command, args) {
            if (args[0] === 'diff') return `${posterPresetsPath}\n`;
            if (args[0] === 'show') return args[1].startsWith('a') ? posterPresetsSource : targetSource;
            return '';
        },
    });
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtimeSource = readFileSync(join(root, 'deploy/deploy-production-from-s3.sh'), 'utf8');
const posterGateStart = runtimeSource.indexOf('\nreferral_poster_change=false\n');
const posterGateEnd = runtimeSource.indexOf('\nmapfile -t managed_storefront_changes', posterGateStart);
assert.ok(posterGateStart >= 0 && posterGateEnd > posterGateStart);
const posterGate = runtimeSource.slice(posterGateStart, posterGateEnd);

function posterRuntimeFixture(t, targetSource, { baseSource = posterPresetsSource, changedPath } = {}) {
    const output = join(root, '.local-validation/referral-runtime-scope');
    mkdirSync(output, { recursive: true });
    const directory = mkdtempSync(join(output, 'case-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const write = (path, source) => {
        const destination = join(directory, path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, source);
    };
    const commit = () => {
        git(['add', '.']);
        git([
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'commit.gpgsign=false',
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--allow-empty',
            '-qm',
            'local fixture',
        ]);
        return git(['rev-parse', 'HEAD']);
    };
    git(['init', '-q']);
    write(posterPresetsPath, baseSource);
    if (changedPath) write(changedPath, 'old fixture\n');
    const baseSha = commit();
    write(posterPresetsPath, targetSource);
    if (changedPath) write(changedPath, 'new fixture\n');
    const targetSha = commit();
    return {
        gate(scope = 'none') {
            return spawnSync(
                'bash',
                [
                    '-c',
                    `set -Eeuo pipefail\nfail() { printf '%s\\n' "$*" >&2; exit 1; }\n${posterGate}\nprintf 'POSTER_SCOPE_ACCEPTED\\n'`,
                ],
                {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        deployed_sha: baseSha,
                        target_sha: targetSha,
                        reviewed_referral_posters: scope,
                    },
                },
            );
        },
        impact(scope = 'none') {
            return inspectProductionReleaseImpact({
                baseSha,
                targetSha,
                releaseScope: { referralPosters: scope },
                git(command, args, options) {
                    return execFileSync(command, args, { ...options, cwd: directory });
                },
            });
        },
    };
}

test('runtime shell accepts helper-only poster changes without evaluating historical source', t => {
    const baseSource = posterPresetsSource.replace(
        /\n\/\*\* Uploaded artwork owns[\s\S]*?(?=\nexport const referralPosterPresets = )/u,
        '',
    );
    assert.notEqual(baseSource, posterPresetsSource);
    const fixture = posterRuntimeFixture(
        t,
        `${posterPresetsSource}\nthrow new Error('historical source must never execute');\n`,
        { baseSource },
    );
    const result = fixture.gate();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /POSTER_SCOPE_ACCEPTED/u);
    assert.equal(fixture.impact().dataRisk, 'runtime-only');
    assert.notEqual(fixture.gate('primary').status, 0);
    assert.throws(() => fixture.impact('primary'), /without a matching change/u);
});

test('runtime shell still requires reviewed scope for changed poster copy, presets and content identity', t => {
    for (const [before, after] of [
        ['精选商品与服务', 'New published copy'],
        ["foregroundColor: '#152c49'", "foregroundColor: '#102030'"],
        ['referral-poster-${id.toLowerCase()', 'new-poster-${id.toLowerCase()'],
    ]) {
        const source = posterPresetsSource.replace(before, after);
        assert.notEqual(source, posterPresetsSource);
        const fixture = posterRuntimeFixture(t, source);
        const rejected = fixture.gate();
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr, /managed referral posters changed/u);
        assert.throws(() => fixture.impact(), /reviewed release scope was not selected/u);
        const accepted = fixture.gate('primary');
        assert.equal(accepted.status, 0, accepted.stderr);
        assert.equal(fixture.impact('primary').dataRisk, 'managed-content');
    }
});

test('runtime shell preserves whole-path review for poster assets and the publisher', t => {
    for (const changedPath of [
        'packages/dev-server/assets/referral-posters/manifest.json',
        'packages/dev-server/scripts/sync-referral-posters.mjs',
    ]) {
        const fixture = posterRuntimeFixture(t, posterPresetsSource, { changedPath });
        assert.notEqual(fixture.gate().status, 0);
        assert.throws(() => fixture.impact(), /reviewed release scope was not selected/u);
        assert.equal(fixture.gate('both-stores').status, 0);
        assert.equal(fixture.impact('both-stores').dataRisk, 'managed-content');
    }
});

test('runtime shell and preflight reject imported, missing, duplicate or malformed poster manifests', t => {
    for (const source of [
        `import { data } from './other';\n${posterPresetsSource}`,
        'export const otherData = [];',
        `${posterPresetsSource}\nexport const referralPosterCopy = {\n} as const;\n`,
        posterPresetsSource.replace(
            'export const referralPosterPresets = [',
            'export const otherPresets = [',
        ),
        posterPresetsSource.replace(
            /(export const referralPosterPresets = \[[\s\S]*?)\n\] as const;/u,
            '$1\n];',
        ),
    ]) {
        const fixture = posterRuntimeFixture(t, source);
        for (const scope of ['none', 'primary']) {
            const result = fixture.gate(scope);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /could not inspect the target referral poster manifest/u);
            assert.throws(() => fixture.impact(scope), /Cannot isolate/u);
        }
    }
    const invalidBase = posterRuntimeFixture(t, posterPresetsSource, {
        baseSource: 'unrecognized old source',
    });
    assert.match(invalidBase.gate().stderr, /could not inspect the deployed referral poster manifest/u);
    assert.throws(() => invalidBase.impact(), /Cannot isolate/u);
});

test('poster runtime helpers do not require or authorize publishing unchanged managed data', () => {
    const source = `${posterPresetsSource}\nexport type RuntimePosterFields = string;\n`;
    const impact = inspectPosterChange(source);
    assert.equal(impact.dataRisk, 'runtime-only');
    assert.ok(!impact.affectedChecks.includes('managed-content'));
    assert.throws(
        () => inspectPosterChange(source, { referralPosters: 'primary' }),
        /without a matching change/u,
    );
});

test('poster copy, palettes and content identities still require an explicit reviewed publisher scope', () => {
    for (const [before, after] of [
        ['精选商品与服务', 'New published copy'],
        ["foregroundColor: '#152c49'", "foregroundColor: '#102030'"],
        ['referral-poster-${id.toLowerCase()', 'new-poster-${id.toLowerCase()'],
    ]) {
        const source = posterPresetsSource.replace(before, after);
        assert.notEqual(source, posterPresetsSource);
        assert.throws(() => inspectPosterChange(source), /reviewed release scope was not selected/u);
        const impact = inspectPosterChange(source, { referralPosters: 'primary' });
        assert.equal(impact.dataRisk, 'managed-content');
        assert.equal(impact.backupPolicy, 'fresh');
    }
});

test('unknown or deleted poster manifest declarations fail closed', () => {
    assert.throws(() => inspectPosterChange('export const otherData = [];'), /Cannot isolate/u);
    assert.throws(
        () => inspectPosterChange(`import { data } from './other';\n${posterPresetsSource}`),
        /Cannot isolate/u,
    );
});

test('poster assets and publisher changes continue to require review regardless of unchanged preset data', () => {
    for (const file of [
        'packages/dev-server/assets/referral-posters/manifest.json',
        'packages/dev-server/scripts/sync-referral-posters.mjs',
    ]) {
        assert.throws(
            () => classifyProductionReleaseImpact([file], {}, { referralPosterManifestChanged: false }),
            /reviewed release scope was not selected/u,
        );
    }
});

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

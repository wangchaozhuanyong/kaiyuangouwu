import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { classifyChanges } from './ci-impact.mjs';
import {
    frontendSnapshot,
    retainedFrontendPlan,
    verifyFrontendSnapshot,
} from './release-preserve-frontends.mjs';

const packages = [
    { directory: 'icloud-relay-plugin', name: '@vendure/icloud-relay-plugin' },
    {
        directory: 'dev-server',
        name: '@vendure/dev-server',
        dependencies: { '@vendure/icloud-relay-plugin': '*' },
    },
    { directory: 'storefront', name: '@vendure/storefront' },
    { directory: 'store-management-plugin', name: '@vendure/store-management-plugin' },
    { directory: 'next-admin', name: '@vendure/next-admin', devDependencies: { '@vendure/dev-server': '*' } },
];
test('retain mode checks the mailbox backend while leaving unrelated frontend changes unpublished', () => {
    const files = [
        'packages/icloud-relay-plugin/src/services/icloud-idle.service.ts',
        'packages/storefront/src/safe-image.tsx',
    ];
    const result = retainedFrontendPlan(classifyChanges(files, packages), packages);
    assert.equal(result.lane, 'runtime');
    assert.deepEqual(result.frontends, []);
    assert.deepEqual(result.changedPackages, ['icloud-relay-plugin']);
    for (const extra of [
        'package.json',
        'bun.lock',
        'packages/core/src/index.ts',
        'deploy/nginx/damatong.conf',
    ])
        assert.throws(() => retainedFrontendPlan(classifyChanges([...files, extra], packages), packages));
    assert.throws(() =>
        retainedFrontendPlan(classifyChanges(['packages/storefront/src/safe-image.tsx'], packages), packages),
    );
});
test('mailbox health governance files keep the frontend pointers while unrelated store logic is rejected', () => {
    const files = [
        'packages/store-management-plugin/src/constants.ts',
        'packages/store-management-plugin/src/merchant-catalog-access.service.ts',
        'packages/store-management-plugin/src/administrator-access.interceptor.spec.ts',
        'packages/store-management-plugin/src/merchant-catalog-access.service.spec.ts',
    ];
    const consumers = packages.map(pkg =>
        pkg.directory === 'dev-server'
            ? { ...pkg, dependencies: { ...pkg.dependencies, '@vendure/store-management-plugin': '*' } }
            : pkg,
    );
    assert.deepEqual(classifyChanges(files, consumers).frontends, ['next-admin']);
    const result = retainedFrontendPlan(classifyChanges(files, consumers), consumers);
    assert.equal(result.lane, 'runtime');
    assert.deepEqual(result.frontends, []);
    assert.deepEqual(result.changedPackages, ['store-management-plugin']);
    for (const file of [
        'packages/store-management-plugin/src/merchant-initial-password.service.ts',
        'packages/store-management-plugin/src/merchant-catalog-access.service.ts.extra',
        'packages/store-management-plugin/src/promotion.service.ts',
    ])
        assert.throws(() => retainedFrontendPlan(classifyChanges([...files, file], packages), packages));
});
test('real pointer and full asset snapshots reject moved versions, changes, extra files and symlinks', () => {
    const base = path.resolve('.runtime/mailbox-release/frontend-tests');
    mkdirSync(base, { recursive: true });
    const temporary = mkdtempSync(path.join(base, 'case-'));
    try {
        const options = {
            pointerDirectory: temporary,
            storefrontSha: 'a'.repeat(40),
            adminSha: 'b'.repeat(40),
        };
        for (const component of ['storefront', 'next-admin', 'two-factor']) {
            const directory = path.join(temporary, 'kaiyuangouwu-frontend-releases', component);
            mkdirSync(directory, { recursive: true });
            writeFileSync(path.join(directory, 'index.html'), component);
            writeFileSync(
                path.join(directory, 'frontend-release.json'),
                JSON.stringify({
                    sourceSha: component === 'next-admin' ? options.adminSha : options.storefrontSha,
                }),
            );
            symlinkSync(directory, path.join(temporary, `kaiyuangouwu-${component}-current`));
        }
        const snapshot = frontendSnapshot(options);
        verifyFrontendSnapshot(snapshot, options);
        assert.throws(() => frontendSnapshot({ ...options, storefrontSha: 'c'.repeat(40) }));
        const index = path.join(temporary, 'kaiyuangouwu-frontend-releases/storefront/index.html');
        writeFileSync(index, 'changed');
        assert.throws(() => verifyFrontendSnapshot(snapshot, options));
        writeFileSync(index, 'storefront');
        const extra = path.join(temporary, 'kaiyuangouwu-frontend-releases/two-factor/extra.js');
        writeFileSync(extra, 'extra');
        assert.throws(() => verifyFrontendSnapshot(snapshot, options));
        rmSync(extra);
        symlinkSync(index, extra);
        assert.throws(() => verifyFrontendSnapshot(snapshot, options));
    } finally {
        rmSync(temporary, { recursive: true });
    }
});

test('the real switch branch leaves all three pointers untouched in retain mode', () => {
    const script = readFileSync('deploy/deploy-production-from-s3.sh', 'utf8');
    const start = script.indexOf(
        'if [[ "$retain_frontends" == true ]]; then',
        script.indexOf('# Initialize/switch the frontend'),
    );
    const end = script.indexOf('sudo -n cp -p', start);
    assert.ok(start > 0 && end > start);
    const block = script.slice(start, end);
    const setup = `set -Eeuo pipefail
repository=/repo
candidate=/candidate
storefront_pointer=/storefront
two_factor_pointer=/two-factor
admin_pointer=/admin
frontend_preservation_receipt=/receipt
expected_storefront_sha=first
expected_admin_sha=second
node(){ echo "node:$*"; }
sudo(){ echo "sudo:$*"; }
`;
    for (const retain of ['true', 'false']) {
        const result = spawnSync('bash', ['-c', setup + 'retain_frontends=' + retain + '\n' + block], {
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        if (retain === 'true') {
            assert.match(result.stdout, /verify \/receipt first second/u);
            assert.doesNotMatch(result.stdout, /switch/u);
        } else assert.equal((result.stdout.match(/switch/g) ?? []).length, 3);
    }
    assert.ok(
        script.lastIndexOf('"$frontend_preservation_receipt"') < script.lastIndexOf('rollback_needed=0'),
    );
});

test('the real bootstrap re-entry forwards the frontend retention flag and both observed revisions', () => {
    const script = readFileSync('deploy/deploy-production-from-s3.sh', 'utf8');
    const start = script.indexOf('if [[ "${VENDURE_DEPLOY_REEXECUTED:-0}" != "1" ]]');
    const end = script.indexOf('readonly computed_release_impact=', start);
    assert.ok(start > 0 && end > start);
    const base = path.resolve('.runtime/mailbox-release/frontend-tests');
    mkdirSync(base, { recursive: true });
    const temporary = mkdtempSync(path.join(base, 'reentry-'));
    try {
        const entry = path.join(temporary, 'deploy/deploy-production-from-s3.sh');
        mkdirSync(path.dirname(entry), { recursive: true });
        writeFileSync(entry, '#!/usr/bin/env bash\nset -Eeuo pipefail\nprintf "%s\\n" "$@"\n');
        chmodSync(entry, 0o700);
        const forwarded = [...script.slice(start, end).matchAll(/\$\{([a-z_][a-z0-9_]*)\}/gu)].map(
            match => match[1],
        );
        const setup = `set -Eeuo pipefail
VENDURE_DEPLOY_REEXECUTED=0
${[...new Set(forwarded)].map(name => `${name}=fixture`).join('\n')}
repository="$1"
retain_frontends="$2"
expected_storefront_sha="$3"
expected_admin_sha="$4"
`;
        for (const retain of ['true', 'false']) {
            const result = spawnSync(
                'bash',
                [
                    '-c',
                    setup + script.slice(start, end),
                    'bootstrap',
                    temporary,
                    retain,
                    'a'.repeat(40),
                    'b'.repeat(40),
                ],
                { encoding: 'utf8' },
            );
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(result.stdout.trim().split('\n'), [
                'fixture',
                'fixture',
                'fixture',
                retain,
                'a'.repeat(40),
                'b'.repeat(40),
            ]);
        }
    } finally {
        rmSync(temporary, { recursive: true });
    }
});

test('the deployed SSM receipt must prove retention before a mailbox release can succeed', () => {
    const workflow = readFileSync('.github/workflows/deploy_production_runtime.yml', 'utf8');
    const start = workflow.indexOf(
        'if [[ "$RETAIN_FRONTENDS" == true ]]; then',
        workflow.indexOf("jq '{Status, ResponseCode}'"),
    );
    const end = workflow.indexOf(
        "jq -r '.StandardOutputContent",
        workflow.indexOf('\n                    fi', start),
    );
    assert.ok(start > 0 && end > start);
    const block = workflow
        .slice(start, end)
        .split('\n')
        .map(line => line.trimStart())
        .join('\n');
    const setup = `set -Eeuo pipefail
RETAIN_FRONTENDS="$1"
EXPECTED_STOREFRONT_SHA=first
EXPECTED_ADMIN_SHA=second
SSM_RESULT=fixture
jq(){ printf '%s\\n' "$RECEIPT"; }
`;
    for (const [retain, receipt, expected] of [
        ['true', 'PRODUCTION_FRONTEND_PRESERVED storefront=first next-admin=second', 0],
        ['true', 'PRODUCTION_DEPLOY_OK', 1],
        ['true', 'PRODUCTION_FRONTEND_PRESERVED storefront=other next-admin=second', 1],
        ['false', 'PRODUCTION_DEPLOY_OK', 0],
    ]) {
        const result = spawnSync('bash', ['-c', setup + block, 'receipt', retain], {
            encoding: 'utf8',
            env: { ...process.env, RECEIPT: receipt },
        });
        assert.equal(result.status, expected, result.stderr);
    }
});

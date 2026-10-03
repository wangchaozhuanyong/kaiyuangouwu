import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { classifyChanges } from '../scripts/ci-impact.mjs';

import { classifyFailure } from './release-recovery.mjs';
import { selectReleaseRoute } from './release-route.mjs';

const deploymentScript = readFileSync(new URL('./deploy-production-from-s3.sh', import.meta.url), 'utf8');
const shellFunction = name => {
    const start = deploymentScript.indexOf(`${name}() {`);
    assert.ok(start >= 0);
    return deploymentScript.slice(start, deploymentScript.indexOf('\n}', start) + 2);
};

test('the frozen migration backup is reverified without readonly assignment or accepting another snapshot', () => {
    const fixture = `
set -Eeuo pipefail
invocation=c7b78f2cb12a4295bdd1c7387c326c1f
snapshot=/var/backups/vendure-mysql/vendure-20261003T101136Z.sql.gz
checksum_ok=1
sudo() {
    shift
    case "$1" in
        systemctl) if [[ "$*" == *Result* ]]; then printf 'success'; else printf '%s' "$invocation"; fi ;;
        journalctl) printf 'Created verified MySQL backup: %s offsite=yes encrypted=yes\\n' "$snapshot" ;;
        test) return 0 ;;
        /usr/local/sbin/vendure-mysql-backup-manifest.py|jq) printf '2' ;;
        /bin/bash) [[ "$checksum_ok" == 1 ]] ;;
        stat) printf '100' ;;
        *) return 1 ;;
    esac
}
date() { printf '120'; }
${shellFunction('load_verified_backup')}
backup_file=""; backup_invocation_id=""; backup_age_seconds=""
load_verified_backup
readonly backup_file backup_invocation_id backup_age_seconds
load_verified_backup verify
[[ "$backup_age_seconds" == 20 ]]
invocation=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if load_verified_backup verify; then exit 21; fi
invocation=c7b78f2cb12a4295bdd1c7387c326c1f
snapshot=/var/backups/vendure-mysql/vendure-20261003T121136Z.sql.gz
if load_verified_backup verify; then exit 22; fi
snapshot=/var/backups/vendure-mysql/vendure-20261003T101136Z.sql.gz
checksum_ok=0
if load_verified_backup verify; then exit 23; fi
printf 'FROZEN_BACKUP_REVERIFIED\\n'
`;
    const result = spawnSync('bash', ['-c', fixture], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'FROZEN_BACKUP_REVERIFIED\n');
    assert.match(deploymentScript, /load_verified_backup verify \|\| fail/u);
});

test('fatal shell errors still enter guarded recovery after writers were paused', () => {
    for (const flags of [
        'rollback_needed=1; worker_paused_early=0',
        'rollback_needed=0; worker_paused_early=1',
    ]) {
        const result = spawnSync(
            'bash',
            [
                '-c',
                `
set -Eeuo pipefail
${flags}
cleanup() { printf 'CLEANUP\\n'; }
rollback() { printf 'GUARDED_RECOVERY status=%s\\n' "$1"; exit "$1"; }
${shellFunction('handle_deploy_exit')}
trap handle_deploy_exit EXIT
readonly proof=frozen
proof=changed
`,
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /readonly variable/u);
        assert.equal(result.stdout, 'GUARDED_RECOVERY status=1\n');
    }
    const success = spawnSync(
        'bash',
        [
            '-c',
            `
set -Eeuo pipefail
rollback_needed=0; worker_paused_early=0
cleanup() { printf 'CLEANUP\\n'; }
rollback() { exit 99; }
${shellFunction('handle_deploy_exit')}
trap handle_deploy_exit EXIT
true
`,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout, 'CLEANUP\n');
});

test('only a proven infrastructure fault permits one retry', () => {
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 1).retryAllowed, true);
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 2).retryAllowed, false);
    for (const logs of [
        'TS2345: invalid type',
        'HTTP 503 then AssertionError',
        'AccessDenied',
        '',
        'checksum mismatch',
        'migration failed',
    ])
        assert.equal(classifyFailure(logs).retryAllowed, false);
});
const old = 'a'.repeat(40);
const target = 'b'.repeat(40);
test('an active client still updates the Admin preview when its pointer is older', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css']);
    const route = selectReleaseRoute({
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: target,
        adminSha: old,
        changedSince: (_source, _target, component) => component === 'next-admin',
    });
    assert.equal(route.lane, 'frontend');
    assert.deepEqual(route.components, ['next-admin']);
});
test('cumulative backend changes and explicit managed writes cannot use a static release', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/core/src/order.ts']);
    assert.equal(
        selectReleaseRoute({ plan, baseSha: old, targetSha: target, storefrontSha: old, adminSha: old }).lane,
        'runtime',
    );
    assert.equal(
        selectReleaseRoute({
            plan: classifyChanges(['packages/storefront/src/index.css']),
            baseSha: old,
            targetSha: target,
            storefrontSha: old,
            adminSha: old,
            managed: true,
        }).lane,
        'runtime',
    );
});
test('independent admin release requires bootstrap and includes both changed frontends', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/next-admin/src/index.css']);
    const input = {
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: old,
        adminSha: old,
        changedSince: () => true,
    };
    assert.equal(selectReleaseRoute({ ...input, adminSha: 'unknown' }).lane, 'runtime');
    assert.deepEqual(selectReleaseRoute(input).components, ['next-admin', 'storefront']);
});

test('a later storefront release does not redeploy an unchanged active admin', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/next-admin/src/index.css']);
    const route = selectReleaseRoute({
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: old,
        adminSha: 'c'.repeat(40),
        changedSince: (_source, _target, component) => component === 'storefront',
    });
    assert.equal(route.lane, 'frontend');
    assert.deepEqual(route.components, ['storefront']);
});

test('an active backend with drifted frontend pointers cannot trigger an empty-diff release loop', () => {
    const input = {
        plan: classifyChanges([]),
        baseSha: target,
        targetSha: target,
        storefrontSha: target,
        adminSha: target,
    };
    assert.equal(selectReleaseRoute(input).lane, 'none');
    assert.throws(() => selectReleaseRoute({ ...input, adminSha: old }), /Frontend version drift/u);
});

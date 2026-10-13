import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { frontendDeployCommand } from './frontend-ssm.mjs';

const script = readFileSync(new URL('./deploy-frontends-from-s3.sh', import.meta.url), 'utf8');
const temporaryRoot = fileURLToPath(new URL('../.local-validation/frontend-disk-guard/', import.meta.url));
mkdirSync(temporaryRoot, { recursive: true });
const sourceSha = 'a'.repeat(40);
const invocation = {
    sha: sourceSha,
    archive: `frontends-${sourceSha}-123-1.tar.gz`,
    checksum: 'b'.repeat(64),
    components: 'storefront',
};

function fixture(t) {
    const root = mkdtempSync(join(temporaryRoot, 'case-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function maintenancePrefix(helper) {
    const command = frontendDeployCommand(invocation);
    return command
        .slice(0, command.indexOf('\nsudo -H -u ubuntu'))
        .replace('/usr/local/sbin/vendure-production-disk-maintenance', helper);
}

function executePrefix(helper) {
    return spawnSync(
        'sh',
        ['-c', `${maintenancePrefix(helper)}\nprintf 'DEPLOYMENT_START\\n'\nVENDURE_FRONTEND_HOST`],
        {
            encoding: 'utf8',
        },
    );
}

test('installed maintenance runs as the outer command before the ubuntu deployment acquires its lock', t => {
    const root = fixture(t);
    const helper = join(root, 'maintenance');
    writeFileSync(helper, '#!/bin/bash\n[[ "$1" == --apply ]] || exit 9\nprintf "MAINTENANCE_APPLIED\\n"\n', {
        mode: 0o755,
    });
    const result = executePrefix(helper);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'MAINTENANCE_APPLIED\nDEPLOYMENT_START\n');
    assert.ok(
        frontendDeployCommand(invocation).indexOf('"$disk_maintenance" --apply') <
            frontendDeployCommand(invocation).indexOf('sudo -H -u ubuntu'),
    );
    assert.ok(!script.includes('vendure-production-disk-maintenance'));
    assert.ok(!/systemctl[^\n]+start[^\n]+retention/u.test(script));
});

test('failed or unusable installed maintenance blocks all following deployment commands', t => {
    for (const mode of ['failed', 'not-executable', 'broken-link']) {
        const root = fixture(t);
        const helper = join(root, 'maintenance');
        if (mode === 'broken-link') symlinkSync(join(root, 'missing'), helper);
        else
            writeFileSync(helper, '#!/bin/bash\nexit 7\n', {
                mode: mode === 'not-executable' ? 0o644 : 0o755,
            });
        const result = executePrefix(helper);
        assert.notEqual(result.status, 0);
        assert.ok(!result.stdout.includes('DEPLOYMENT_START'));
        assert.ok(!result.stdout.includes('NOT_INSTALLED'));
    }
});

test('first bootstrap may proceed when maintenance is absent and emits a clear not-installed receipt', t => {
    const result = executePrefix(join(fixture(t), 'not-installed'));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith('FRONTEND_DISK_MAINTENANCE_NOT_INSTALLED '));
    assert.ok(result.stdout.endsWith('DEPLOYMENT_START\n'));
});

function budgetFixture(
    t,
    { archiveBytes = '52428800', headStatus = 0, budgetStatus = 0, omitHelper = false } = {},
) {
    const root = fixture(t);
    const bin = join(root, 'bin');
    const deploy = join(root, 'deploy/systemd');
    mkdirSync(bin);
    mkdirSync(deploy, { recursive: true });
    const awsLog = join(root, 'aws.args');
    writeFileSync(
        join(bin, 'aws'),
        [
            '#!/bin/bash',
            'printf "%s\\n" "$@" > "$FRONTEND_TEST_AWS_LOG"',
            '[[ "$FRONTEND_TEST_HEAD_STATUS" == 0 ]] || exit "$FRONTEND_TEST_HEAD_STATUS"',
            'printf "%s\\n" "$FRONTEND_TEST_HEAD_LENGTH"',
            '',
        ].join('\n'),
        { mode: 0o755 },
    );
    if (!omitHelper)
        writeFileSync(
            join(deploy, 'vendure-disk-budget.py'),
            [
                'import json,pathlib,sys',
                'pathlib.Path(__file__).with_suffix(".args.json").write_text(json.dumps(sys.argv[1:]))',
                `print(json.dumps({"status":"${budgetStatus ? 'insufficient' : 'ok'}"}))`,
                `sys.exit(${budgetStatus})`,
                '',
            ].join('\n'),
        );
    const start = script.indexOf('readonly disk_budget=');
    const end = script.indexOf('sudo -n install -d', start);
    assert.ok(start > 0 && end > start);
    const stageGate = script.slice(start, end);
    const result = spawnSync(
        'bash',
        [
            '-c',
            [
                'set -Eeuo pipefail',
                'controls_root="$1"',
                'artifact_bucket=approved-production-bucket',
                'target_sha="$2"',
                'archive_name="$3"',
                'fail() { printf "%s\\n" "$*" >&2; exit 1; }',
                '',
            ].join('\n') +
                stageGate +
                '\nprintf "DOWNLOAD_START\\n"',
            '--',
            root,
            sourceSha,
            invocation.archive,
        ],
        {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                FRONTEND_TEST_AWS_LOG: awsLog,
                FRONTEND_TEST_HEAD_STATUS: String(headStatus),
                FRONTEND_TEST_HEAD_LENGTH: archiveBytes,
            },
        },
    );
    return { result, awsLog, budgetArgs: join(deploy, 'vendure-disk-budget.args.json') };
}

test('frontend budget measures the exact S3 archive and uses the existing extraction ceiling before download', t => {
    const { result, awsLog, budgetArgs } = budgetFixture(t);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(awsLog, 'utf8').trim().split('\n'), [
        's3api',
        'head-object',
        '--bucket',
        'approved-production-bucket',
        '--key',
        `deployments/${sourceSha}/${invocation.archive}`,
        '--query',
        'ContentLength',
        '--output',
        'text',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(budgetArgs, 'utf8')), [
        'stage',
        '--archive-bytes',
        '52428800',
        '--runtime-bytes',
        '1073741824',
    ]);
    assert.ok(result.stdout.indexOf('FRONTEND_STAGING_DISK_OK') < result.stdout.indexOf('DOWNLOAD_START'));
    assert.ok(script.indexOf('stage --archive-bytes') < script.indexOf('readonly staging='));
    assert.ok(script.indexOf('stage --archive-bytes') < script.indexOf('aws s3 cp'));
    assert.ok(script.includes('if sum(m.size for m in members)>1024*1024*1024'));
    assert.ok(script.includes('trap \'rm -rf -- "$staging"\' EXIT'));
});

test('failed metadata reads or malformed archive sizes block before the disk gate and download', t => {
    const cases = [
        { headStatus: 5 },
        ...['', '0', '-1', '1.5', 'None', '10GiB'].map(archiveBytes => ({ archiveBytes })),
    ];
    for (const input of cases) {
        const { result, budgetArgs } = budgetFixture(t, input);
        assert.notEqual(result.status, 0);
        assert.ok(!result.stdout.includes('DOWNLOAD_START'));
        assert.ok(!existsSync(budgetArgs));
    }
});

test('an insufficient disk budget blocks download and leaves the stage allocation unstarted', t => {
    const { result, budgetArgs } = budgetFixture(t, { budgetStatus: 1 });
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(budgetArgs));
    assert.ok(result.stderr.includes('Root disk cannot stage the frontend within the health limit'));
    assert.ok(!result.stdout.includes('DOWNLOAD_START'));
    assert.ok(!result.stdout.includes('FRONTEND_STAGING_DISK_OK'));
});

test('target controls lacking the budget helper fail before contacting S3', t => {
    const { result, awsLog } = budgetFixture(t, { omitHelper: true });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Target controls omit the frontend disk budget gate'));
    assert.ok(!existsSync(awsLog));
});

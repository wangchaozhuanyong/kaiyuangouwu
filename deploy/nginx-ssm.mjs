import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { maskedDeploymentLines } from './frontend-ssm.mjs';

export function nginxDeployCommand({
    sha,
    archive,
    checksum,
    configHash,
    backendSha,
    storefrontSha,
    adminSha,
}) {
    for (const value of [sha, backendSha, storefrontSha, adminSha])
        assert.match(value ?? '', /^[a-f0-9]{40}$/u);
    for (const value of [checksum, configHash]) assert.match(value ?? '', /^[a-f0-9]{64}$/u);
    assert.match(archive ?? '', new RegExp(`^nginx-${sha}-[0-9]+-[0-9]+\\.tar\\.gz$`, 'u'));
    return `/bin/bash -s <<'VENDURE_NGINX_HOST'
set -Eeuo pipefail
[[ ! -L /var/www/kaiyuangouwu-nginx-releases ]] || { echo 'Nginx release root must not be a symlink' >&2; exit 1; }
install -d -o ubuntu -g ubuntu -m 0755 /var/www/kaiyuangouwu-nginx-releases
sudo -H -u ubuntu /bin/bash -s -- ${sha} ${archive} ${checksum} ${configHash} ${backendSha} ${storefrontSha} ${adminSha} <<'VENDURE_NGINX_CONTROLS'
set -Eeuo pipefail
cd /var/www/kaiyuangouwu
git fetch origin main --no-tags
[[ "$(git rev-parse origin/main)" == "$1" ]] || { echo 'Target is no longer current main' >&2; exit 1; }
controls=$(mktemp -d /var/www/kaiyuangouwu-nginx-releases/.controls-XXXXXX)
trap 'rm -rf -- "$controls"' EXIT
git archive "$1" deploy scripts | tar -x -C "$controls"
/bin/bash "$controls/deploy/deploy-nginx-from-s3.sh" "$@"
VENDURE_NGINX_CONTROLS
VENDURE_NGINX_HOST`;
}

export function nginxReceiptFromInvocation(result, { sha, configHash, backendSha, commandId }) {
    assert.equal(result.CommandId, commandId);
    assert.equal(result.InstanceId, 'i-01d6737449bc52460');
    assert.equal(result.Comment, `Nginx release ${sha}`);
    assert.equal(result.Status, 'Success', 'Nginx deployment did not complete successfully');
    assert.equal(result.ResponseCode, 0);
    const output = String(result.StandardOutputContent ?? '');
    assert.ok(
        output.endsWith(`NGINX_DEPLOYED_OK sha=${sha} config_sha256=${configHash}\n`),
        'Nginx acceptance output is incomplete',
    );
    const receipts = output.split('\n').filter(line => line.startsWith('NGINX_RECEIPT '));
    assert.equal(receipts.length, 1, 'Expected exactly one Nginx acceptance receipt');
    const receipt = JSON.parse(receipts[0].slice('NGINX_RECEIPT '.length));
    assert.equal(receipt.sourceSha, sha);
    assert.equal(receipt.configSha256, configHash);
    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.before.runtimeSha, backendSha);
    assert.deepEqual(receipt.before, receipt.after, 'Serving identities changed during the Nginx release');
    return receipt;
}

async function main() {
    const {
        TARGET_SHA: sha,
        ARCHIVE: archive,
        ARCHIVE_SHA256: checksum,
        CONFIG_SHA256: configHash,
        BASE_SHA: backendSha,
        STOREFRONT_SHA: storefrontSha,
        ADMIN_SHA: adminSha,
    } = process.env;
    const command = nginxDeployCommand({
        sha,
        archive,
        checksum,
        configHash,
        backendSha,
        storefrontSha,
        adminSha,
    });
    const aws = args =>
        JSON.parse(
            execFileSync(
                'aws',
                [...args, '--region', 'ap-northeast-1', '--output', 'json', '--cli-read-timeout', '30'],
                { encoding: 'utf8', maxBuffer: 1024 * 1024 },
            ),
        );
    const submitted = aws([
        'ssm',
        'send-command',
        '--document-name',
        'AWS-RunShellScript',
        '--instance-ids',
        'i-01d6737449bc52460',
        '--comment',
        `Nginx release ${sha}`,
        '--parameters',
        JSON.stringify({ commands: [command], executionTimeout: ['600'] }),
    ]);
    const commandId = submitted.Command.CommandId;
    assert.match(commandId, /^[a-f0-9-]+$/u);
    const deadline = Date.now() + 660000;
    let result;
    while (Date.now() < deadline) {
        try {
            result = aws([
                'ssm',
                'get-command-invocation',
                '--command-id',
                commandId,
                '--instance-id',
                'i-01d6737449bc52460',
            ]);
        } catch (error) {
            if (!/InvocationDoesNotExist/u.test(String(error.stderr))) throw error;
        }
        if (result && !['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    // Keep only bounded, masked diagnostics; never dump the native invocation.
    if (result?.Status !== 'Success') {
        process.stderr.write(
            JSON.stringify({
                commandId,
                status: result?.Status ?? 'unavailable',
                diagnostics: maskedDeploymentLines(result?.StandardErrorContent),
            }) + '\n',
        );
    }
    assert.equal(result?.Status, 'Success', `Nginx release failed or timed out; SSM command ${commandId}`);
    const receipt = nginxReceiptFromInvocation(result, { sha, configHash, backendSha, commandId });
    assert.ok(process.env.NGINX_RECEIPT_PATH, 'Missing controlled receipt output path');
    writeFileSync(
        process.env.NGINX_RECEIPT_PATH,
        JSON.stringify({ ...receipt, commandId, archiveSha256: checksum }) + '\n',
        { flag: 'wx' },
    );
    const summary =
        `## Nginx release completed\n\nSource: ${sha}\n\nConfiguration SHA-256: ${configHash}\n\n` +
        `Artifact SHA-256: ${checksum}\n\nSSM command: ${commandId}\n\n` +
        'API/Worker PIDs and uptimes, runtime and frontend identities were preserved. ' +
        'Three-store public HTML/API header acceptance passed.\n';
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

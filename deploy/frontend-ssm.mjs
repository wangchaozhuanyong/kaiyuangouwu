import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function frontendDeployCommand({ sha, archive, checksum, components }) {
    assert.match(sha ?? '', /^[a-f0-9]{40}$/u);
    assert.match(archive ?? '', new RegExp(`^frontends-${sha}-[0-9]+-[0-9]+\\.tar\\.gz$`, 'u'));
    assert.match(checksum ?? '', /^[a-f0-9]{64}$/u);
    assert.ok(['storefront', 'next-admin', 'next-admin,storefront'].includes(components));
    return `sudo -H -u ubuntu /bin/bash -s -- ${sha} ${archive} ${checksum} ${components} <<'VENDURE_FRONTEND_CONTROLS'
set -Eeuo pipefail
cd /var/www/kaiyuangouwu
git fetch origin main --no-tags
[[ "$(git rev-parse origin/main)" == "$1" ]] || { echo 'Target is no longer current main' >&2; exit 1; }
# Use the reviewed target controls without changing the active backend checkout.
mkdir -p /var/www/kaiyuangouwu-frontend-releases
controls=$(mktemp -d /var/www/kaiyuangouwu-frontend-releases/.controls-XXXXXX)
trap 'rm -rf -- "$controls"' EXIT
git archive "$1" deploy scripts | tar -x -C "$controls"
/bin/bash "$controls/deploy/deploy-frontends-from-s3.sh" "$@"
VENDURE_FRONTEND_CONTROLS`;
}

async function main() {
    const {
        TARGET_SHA: sha,
        ARCHIVE: archive,
        ARCHIVE_SHA256: checksum,
        COMPONENTS: components,
    } = process.env;
    assert.match(sha ?? '', /^[a-f0-9]{40}$/u);
    assert.match(archive ?? '', new RegExp(`^frontends-${sha}-[0-9]+-[0-9]+\\.tar\\.gz$`, 'u'));
    assert.match(checksum ?? '', /^[a-f0-9]{64}$/u);
    assert.ok(['storefront', 'next-admin', 'next-admin,storefront'].includes(components));
    const aws = args =>
        JSON.parse(
            execFileSync(
                'aws',
                [...args, '--region', 'ap-northeast-1', '--output', 'json', '--cli-read-timeout', '30'],
                { encoding: 'utf8', maxBuffer: 1024 * 1024 },
            ),
        );
    const command = frontendDeployCommand({ sha, archive, checksum, components });
    const submitted = aws([
        'ssm',
        'send-command',
        '--document-name',
        'AWS-RunShellScript',
        '--instance-ids',
        'i-041a146558e432cbf',
        '--comment',
        `Frontend release ${sha}`,
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
                'i-041a146558e432cbf',
            ]);
        } catch (error) {
            if (!/InvocationDoesNotExist/u.test(String(error.stderr))) throw error;
        }
        if (result && !['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    assert.equal(
        result?.Status,
        'Success',
        `Frontend deployment failed or timed out; SSM command ${commandId}`,
    );
    assert.equal(result.ResponseCode, 0);
    assert.ok(
        result.StandardOutputContent.endsWith(`FRONTEND_DEPLOYED_OK sha=${sha} components=${components}\n`),
        'Frontend acceptance evidence is incomplete',
    );
    const summary =
        `## Frontend release completed\n\nVersion: ${sha}\n\nComponents: ${components}\n\n` +
        `Artifact SHA-256: ${checksum}\n\nSSM command: ${commandId}\n\n` +
        'Public entry, version manifest and entry-asset acceptance passed. Backend runtime was preserved.\n';
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
}

const instanceId = 'i-041a146558e432cbf';

export function maskedDeploymentLines(value) {
    return String(value ?? '')
        .split('\n')
        .filter(line => !/password|token|cookie|authorization|api.?key|private.?key|secret/iu.test(line))
        .map(line => line.replace(/https?:\/\/\S+/gu, '[URL]').slice(0, 500))
        .filter(Boolean)
        .slice(-80);
}

export function readFrontendInvocation({ commandId, sourceSha }, read) {
    assert.match(commandId ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/u);
    const result = read([
        'ssm',
        'get-command-invocation',
        '--command-id',
        commandId,
        '--instance-id',
        instanceId,
        '--region',
        'ap-northeast-1',
        '--output',
        'json',
        '--cli-read-timeout',
        '30',
    ]);
    assert.equal(result.CommandId, commandId);
    assert.equal(result.InstanceId, instanceId);
    assert.equal(result.Comment, `Frontend release ${sourceSha}`);
    assert.ok(['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(result.Status));
    return {
        commandId,
        sourceSha,
        status: result.Status,
        responseCode: result.ResponseCode,
        stdout: maskedDeploymentLines(result.StandardOutputContent),
        stderr: maskedDeploymentLines(result.StandardErrorContent),
        readOnly: true,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv[2] === 'read-invocation') {
        const receipt = readFrontendInvocation(
            {
                commandId: process.env.FRONTEND_COMMAND_ID,
                sourceSha: process.env.FRONTEND_SOURCE_SHA,
            },
            args => JSON.parse(execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })),
        );
        process.stdout.write(JSON.stringify(receipt) + '\n');
    } else {
        await main();
    }
}

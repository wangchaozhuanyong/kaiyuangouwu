import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const { TARGET_SHA: sha, ARCHIVE: archive, ARCHIVE_SHA256: checksum, COMPONENTS: components } = process.env;
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
const command = `sudo -H -u ubuntu /bin/bash /var/www/kaiyuangouwu/deploy/deploy-frontends-from-s3.sh ${sha} ${archive} ${checksum} ${components}`;
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
assert.equal(result?.Status, 'Success', `Frontend deployment failed or timed out; SSM command ${commandId}`);
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

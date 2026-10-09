import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
    const receipt = readFrontendInvocation(
        {
            commandId: process.env.FRONTEND_COMMAND_ID,
            sourceSha: process.env.FRONTEND_SOURCE_SHA,
        },
        args => JSON.parse(execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })),
    );
    process.stdout.write(JSON.stringify(receipt) + '\n');
}

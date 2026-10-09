import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { maskedDeploymentLines, readFrontendInvocation } from './frontend-ssm.mjs';

const commandId = 'aa4285f5-3701-449c-a23b-aa3407cddeb6';
const sourceSha = '3949cb7468ef0ee53a79eff568305b29d497e642';
const native = {
    CommandId: commandId,
    InstanceId: 'i-041a146558e432cbf',
    Comment: `Frontend release ${sourceSha}`,
    Status: 'Failed',
    ResponseCode: 1,
    StandardOutputContent: 'checksum: OK',
    StandardErrorContent: 'Static routing has not been initialized',
};

test('reads only the fixed production instance and exact command', () => {
    const receipt = readFrontendInvocation({ commandId, sourceSha }, args => {
        assert.deepEqual(args.slice(0, 4), ['ssm', 'get-command-invocation', '--command-id', commandId]);
        assert.equal(args[5], native.InstanceId);
        assert.ok(!args.includes('send-command'));
        return native;
    });
    assert.equal(receipt.readOnly, true);
    assert.deepEqual(receipt.stderr, [native.StandardErrorContent]);
});
test('malformed input is rejected before an AWS read', () => {
    for (const input of [
        { commandId: 'bad', sourceSha },
        { commandId, sourceSha: 'main' },
    ])
        assert.throws(() => readFrontendInvocation(input, () => assert.fail('no call')));
});
test('another host, command or source cannot supply a receipt', () => {
    for (const change of [{ InstanceId: 'i-other' }, { CommandId: 'other' }, { Comment: 'other command' }])
        assert.throws(() =>
            readFrontendInvocation({ commandId, sourceSha }, () => ({ ...native, ...change })),
        );
});
test('in-progress commands are not presented as completed', () => {
    assert.throws(() =>
        readFrontendInvocation({ commandId, sourceSha }, () => ({ ...native, Status: 'InProgress' })),
    );
});
test('deployment output drops credential lines, masks URLs and remains bounded', () => {
    const lines = maskedDeploymentLines(
        'TOKEN=private\npassword=x\nfetch https://example.com/a?signature=x\n' + 'x'.repeat(1000),
    );
    assert.deepEqual(lines, ['fetch [URL]', 'x'.repeat(500)]);
    assert.equal(maskedDeploymentLines('line\n'.repeat(100)).length, 80);
});
test('diagnostic workflow reads the invocation without sending a new host command or notification', () => {
    const w = yaml.load(
        readFileSync(new URL('../.github/workflows/monitor_production_health.yml', import.meta.url), 'utf8'),
    );
    const steps = w.jobs.monitor.steps;
    const read = steps.find(x => x.name === 'Read a bound frontend deployment receipt');
    assert.match(read.run, /node deploy\/frontend-ssm\.mjs read-invocation/u);
    assert.deepEqual(w.permissions, { contents: 'read', 'id-token': 'write' });
    for (const step of steps.filter(
        x => x.name === 'Check production health' || /notification|outages/iu.test(x.name),
    ))
        assert.match(step.if, /read_frontend_command_id == ''/u);
});

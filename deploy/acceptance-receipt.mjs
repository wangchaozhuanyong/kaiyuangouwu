import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateAcceptanceReceipt(receipt, { targetSha, runId, affectedChecks }) {
    assert.equal(receipt.version, 1);
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    assert.equal(receipt.targetSha, targetSha, 'Acceptance revision differs');
    assert.match(String(runId), /^\d+$/u);
    assert.equal(receipt.runId, String(runId), 'Acceptance belongs to another release');
    assert.ok(affectedChecks.includes('all-store-basics'));
    assert.deepEqual(receipt.affectedChecks, affectedChecks, 'Acceptance scope differs');
    return receipt;
}

export function receiptFromInvocation(invocation, expected) {
    assert.equal(invocation.Status, 'Success');
    assert.equal(invocation.ResponseCode, 0);
    const lines = (invocation.StandardOutputContent || '').split('\n');
    assert.ok(lines.includes('PRODUCTION_DEPLOY_OK'), 'Deployment did not commit');
    const receipts = lines.filter(line => line.startsWith('PRODUCTION_DEPLOY_RECEIPT '));
    assert.equal(receipts.length, 1, 'Missing or duplicate server acceptance receipt');
    return validateAcceptanceReceipt(
        JSON.parse(receipts[0].slice('PRODUCTION_DEPLOY_RECEIPT '.length)),
        expected,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, file, output] = process.argv.slice(2);
    const expected = {
        targetSha: process.env.TARGET_SHA,
        runId: process.env.GITHUB_RUN_ID,
        affectedChecks: JSON.parse(process.env.AFFECTED_CHECKS),
    };
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (command === 'extract')
        writeFileSync(output, JSON.stringify(receiptFromInvocation(value, expected)) + '\n');
    else if (command === 'verify') validateAcceptanceReceipt(value, expected);
    else throw new Error('Expected extract or verify');
    process.stdout.write('SERVER_ACCEPTANCE_RECEIPT_VERIFIED\n');
}

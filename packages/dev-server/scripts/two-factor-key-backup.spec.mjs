import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

void test('2FA recovery backup preserves secret boundaries and requires a reviewed plan', () => {
    const result = spawnSync(
        'python3',
        ['-B', fileURLToPath(new URL('./two-factor-key-backup.spec.py', import.meta.url))],
        { encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

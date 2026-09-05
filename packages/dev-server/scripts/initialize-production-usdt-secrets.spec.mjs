import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const initializer = path.join(repositoryRoot, 'deploy/initialize-production-usdt-secrets.mjs');

void test('initializes independent production secrets atomically without printing their values', () => {
    withEnvironmentFile(
        [
            'UNCHANGED=value',
            'USDT_PAYMENT_PROOF_SECRET=replace-with-proof-secret',
            'USDT_WALLET_ENCRYPTION_KEY=',
            'USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS=',
            'TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY=replace-with-dashboard-two-factor-secret',
            '',
        ].join('\n'),
        environmentFile => {
            const firstOutput = execFileSync(process.execPath, [initializer, environmentFile], {
                encoding: 'utf8',
            });
            const firstContents = readFileSync(environmentFile, 'utf8');
            const firstValues = parseEnvironment(firstContents);
            const proofSecret = firstValues.get('USDT_PAYMENT_PROOF_SECRET');
            const walletKey = firstValues.get('USDT_WALLET_ENCRYPTION_KEY');
            const dashboardTwoFactorKey = firstValues.get('TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY');
            const adminLoginKey = firstValues.get('ADMIN_TWO_FACTOR_ENCRYPTION_KEY');

            assert.match(proofSecret ?? '', /^[a-f0-9]{64}$/u);
            assert.match(walletKey ?? '', /^[a-f0-9]{64}$/u);
            assert.match(dashboardTwoFactorKey ?? '', /^[a-f0-9]{64}$/u);
            assert.match(adminLoginKey ?? '', /^[a-f0-9]{64}$/u);
            assert.equal(new Set([proofSecret, walletKey, dashboardTwoFactorKey, adminLoginKey]).size, 4);
            assert.equal(firstOutput.includes(adminLoginKey ?? 'missing'), false);
            assert.notEqual(proofSecret, walletKey);
            assert.notEqual(dashboardTwoFactorKey, proofSecret);
            assert.notEqual(dashboardTwoFactorKey, walletKey);
            assert.equal(firstValues.get('UNCHANGED'), 'value');
            assert.equal(firstOutput.includes(proofSecret ?? 'missing'), false);
            assert.equal(firstOutput.includes(walletKey ?? 'missing'), false);
            assert.equal(firstOutput.includes(dashboardTwoFactorKey ?? 'missing'), false);
            assert.equal(statSync(environmentFile).mode % 0o1000, 0o640);

            const secondOutput = execFileSync(process.execPath, [initializer, environmentFile], {
                encoding: 'utf8',
            });
            assert.equal(readFileSync(environmentFile, 'utf8'), firstContents);
            assert.match(secondOutput, /USDT_PAYMENT_PROOF_SECRET=preserved/u);
            assert.match(secondOutput, /USDT_WALLET_ENCRYPTION_KEY=preserved/u);
            assert.match(secondOutput, /TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY=preserved/u);
            assert.match(secondOutput, /ADMIN_TWO_FACTOR_ENCRYPTION_KEY=preserved/u);
            assert.match(secondOutput, /environment_file_updated=no/u);
        },
    );
});

void test('rejects invalid or reused administrator login keys without replacing configured secrets', () => {
    for (const value of ['too-short', 'z'.repeat(64), 'A'.repeat(64)]) {
        const original = `COOKIE_SECRET=${'a'.repeat(64)}\nADMIN_TWO_FACTOR_ENCRYPTION_KEY=${value}\n`;
        withEnvironmentFile(original, environmentFile => {
            const result = spawnSync(process.execPath, [initializer, environmentFile], { encoding: 'utf8' });
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /ADMIN_TWO_FACTOR_ENCRYPTION_KEY must/u);
            assert.equal(result.stderr.includes(value), false);
            assert.equal(readFileSync(environmentFile, 'utf8'), original);
        });
    }
});

void test('preserves a valid wallet key and rotates a proof secret that reuses it', () => {
    const walletKey = 'wallet-key-that-is-safely-long-and-already-in-use';
    withEnvironmentFile(
        [
            `USDT_PAYMENT_PROOF_SECRET=${walletKey}`,
            `USDT_WALLET_ENCRYPTION_KEY="${walletKey}"`,
            'USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS=previous-wallet-key-that-is-also-long-enough',
            '',
        ].join('\n'),
        environmentFile => {
            execFileSync(process.execPath, [initializer, environmentFile]);
            const contents = readFileSync(environmentFile, 'utf8');
            const values = parseEnvironment(contents);

            assert.match(contents, new RegExp(`USDT_WALLET_ENCRYPTION_KEY="${walletKey}"`, 'u'));
            assert.equal(values.get('USDT_WALLET_ENCRYPTION_KEY'), walletKey);
            assert.notEqual(values.get('USDT_PAYMENT_PROOF_SECRET'), walletKey);
        },
    );
});

void test('rejects unsafe previous wallet keys without modifying the environment file', () => {
    const original = [
        'USDT_PAYMENT_PROOF_SECRET=',
        'USDT_WALLET_ENCRYPTION_KEY=',
        'USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS=short',
        '',
    ].join('\n');
    withEnvironmentFile(original, environmentFile => {
        const result = spawnSync(process.execPath, [initializer, environmentFile], { encoding: 'utf8' });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /PREVIOUS_KEYS contains a missing, short, or placeholder secret/u);
        assert.equal(readFileSync(environmentFile, 'utf8'), original);
    });
});

void test('rejects a production environment file writable by its group', () => {
    withEnvironmentFile('', environmentFile => {
        chmodSync(environmentFile, 0o660);
        const result = spawnSync(process.execPath, [initializer, environmentFile], { encoding: 'utf8' });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /permissions allow unsafe group or other access/u);
        assert.equal(readFileSync(environmentFile, 'utf8'), '');
    });
});

function withEnvironmentFile(contents, callback) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'vendure-usdt-secrets-'));
    const environmentFile = path.join(directory, '.env');
    try {
        writeFileSync(environmentFile, contents, { mode: 0o640 });
        chmodSync(environmentFile, 0o640);
        callback(environmentFile);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function parseEnvironment(contents) {
    const values = new Map();
    for (const line of contents.split(/\r?\n/u)) {
        const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
        if (!match) continue;
        const value = match[2];
        values.set(
            match[1],
            value.length >= 2 && value[0] === '"' && value.at(-1) === '"' ? value.slice(1, -1) : value,
        );
    }
    return values;
}

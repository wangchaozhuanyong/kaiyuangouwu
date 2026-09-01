import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    auditChannelWalletRows,
    fingerprintReceivingAddress,
    isValidTronMainnetAddress,
    selectConsistentRuntimeEnvironment,
} from '../../../deploy/audit-production-payment-config.mjs';

const address = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const currentSecret = `current-wallet-secret-${'x'.repeat(32)}`;
const previousSecret = `previous-wallet-secret-${'y'.repeat(32)}`;

function walletEncryptionKey(secret) {
    return createHash('sha256').update(`storefront-usdt-wallet-encryption:v1:${secret}`).digest();
}

function walletEncryptionKeyId(secret) {
    return createHash('sha256')
        .update(`storefront-usdt-wallet-key-id:v1:${secret}`)
        .digest('hex')
        .slice(0, 16);
}

function encryptAddress(secret, value, version = 'v2') {
    const iv = Buffer.alloc(12, version === 'v2' ? 7 : 9);
    const cipher = createCipheriv('aes-256-gcm', walletEncryptionKey(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const payload = [
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
    ];
    return version === 'v2'
        ? ['v2', walletEncryptionKeyId(secret), ...payload].join(':')
        : ['v1', ...payload].join(':');
}

function runtimeEnvironment(overrides = {}) {
    return {
        DB_HOST: '127.0.0.1',
        DB_PORT: '3306',
        DB_USERNAME: 'vendure',
        DB_PASSWORD: 'masked-test-password',
        DB_NAME: 'vendure',
        USDT_PAYMENT_PROOF_SECRET: `payment-proof-secret-${'p'.repeat(32)}`,
        USDT_WALLET_ENCRYPTION_KEY: currentSecret,
        USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS: previousSecret,
        ...overrides,
    };
}

function pm2Processes(overrides = {}) {
    const environment = { status: 'online', ...runtimeEnvironment(), ...overrides };
    return [
        { name: 'vendure-api', pm2_env: { ...environment } },
        { name: 'vendure-worker', pm2_env: { ...environment } },
    ];
}

void test('payment audit uses the application wallet fingerprint and validates TRON Base58Check', () => {
    const applicationFingerprint = fingerprintReceivingAddress(address);
    const bareFingerprint = createHash('sha256').update(address, 'utf8').digest('hex');

    assert.equal(isValidTronMainnetAddress(address), true);
    assert.match(applicationFingerprint, /^[a-f0-9]{64}$/u);
    assert.notEqual(applicationFingerprint, bareFingerprint);
});

void test('payment audit validates active and pending Channel wallets without exposing wallet values', () => {
    const activeCiphertext = encryptAddress(currentSecret, address);
    const pendingCiphertext = encryptAddress(previousSecret, address);
    const fingerprint = fingerprintReceivingAddress(address);
    const result = auditChannelWalletRows(
        [
            ['PENDING', activeCiphertext, fingerprint, pendingCiphertext, fingerprint],
            ['UNCONFIGURED', '', '', '', ''],
        ],
        runtimeEnvironment(),
    );

    assert.deepEqual(result, {
        channels: 2,
        active: 1,
        pending: 1,
        unconfigured: 1,
        rejected: 0,
        integrityFailures: 0,
        reencryptNeeded: 1,
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(address, 'u'));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(currentSecret, 'u'));
});

void test('payment audit rejects tampered fingerprints and inconsistent review states', () => {
    const ciphertext = encryptAddress(currentSecret, address);
    const fingerprint = fingerprintReceivingAddress(address);
    const result = auditChannelWalletRows(
        [
            ['ACTIVE', ciphertext, '0'.repeat(64), '', ''],
            ['ACTIVE', '', '', '', ''],
            ['REJECTED', ciphertext, fingerprint, '', ''],
        ],
        runtimeEnvironment(),
    );

    assert.equal(result.channels, 3);
    assert.equal(result.integrityFailures, 3);
});

void test('payment audit accepts legacy ciphertext only through the reviewed key ring', () => {
    const legacyCiphertext = encryptAddress(previousSecret, address, 'v1');
    const result = auditChannelWalletRows(
        [['ACTIVE', legacyCiphertext, fingerprintReceivingAddress(address), '', '']],
        runtimeEnvironment(),
    );

    assert.equal(result.active, 1);
    assert.equal(result.integrityFailures, 0);
    assert.equal(result.reencryptNeeded, 1);
});

void test('payment audit requires API and worker to use the same runtime database and key ring', () => {
    const selected = selectConsistentRuntimeEnvironment(pm2Processes());
    assert.deepEqual(selected, runtimeEnvironment());

    const mismatched = pm2Processes();
    mismatched[1].pm2_env.DB_HOST = 'db.internal.example';
    assert.throws(
        () => selectConsistentRuntimeEnvironment(mismatched),
        /API and worker runtime settings differ: DB_HOST/u,
    );
});

void test('payment audit executes when the production workflow streams it through stdin', () => {
    const scriptPath = fileURLToPath(
        new URL('../../../deploy/audit-production-payment-config.mjs', import.meta.url),
    );
    const result = spawnSync(process.execPath, [], {
        encoding: 'utf8',
        input: readFileSync(scriptPath, 'utf8'),
        env: { ...process.env, PATH: '/nonexistent' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /PAYMENT_CONFIG_AUDIT_FAILED/u);
    assert.match(result.stderr, /running PM2 environment is unavailable/u);
});

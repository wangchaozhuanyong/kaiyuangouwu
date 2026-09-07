#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ADDRESS_KEY = 'STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS';
const FINGERPRINT_KEY = 'STOREFRONT_USDT_TRC20_ADDRESS_SHA256';
const DATABASE_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'];
const RUNTIME_KEYS = [
    ...DATABASE_KEYS,
    'USDT_PAYMENT_PROOF_SECRET',
    'USDT_WALLET_ENCRYPTION_KEY',
    'USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS',
];
const RUNTIME_PROCESS_NAMES = ['vendure-api', 'vendure-worker'];
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 5;
const SKIPPED_DIRECTORIES = new Set([
    '.git',
    'assets',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'static',
]);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const REVIEW_STATUSES = new Set(['UNCONFIGURED', 'PENDING', 'ACTIVE', 'REJECTED']);

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest();
}

export function fingerprintReceivingAddress(address) {
    return createHash('sha256').update(`storefront-usdt-wallet:v1:${address}`, 'utf8').digest('hex');
}

function walletEncryptionKey(secret) {
    return createHash('sha256').update(`storefront-usdt-wallet-encryption:v1:${secret}`).digest();
}

function walletEncryptionKeyId(secret) {
    return createHash('sha256')
        .update(`storefront-usdt-wallet-key-id:v1:${secret}`)
        .digest('hex')
        .slice(0, 16);
}

function isAcceptableWalletSecret(value) {
    return value.length >= 32 && !/replace|change|example|placeholder|development/iu.test(value);
}

function isAcceptablePaymentProofSecret(value) {
    return (
        value.length >= 32 && !/(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value)
    );
}

function decodeBase58(value) {
    if (!value) return null;

    let decoded = 0n;
    for (const character of value) {
        const digit = BASE58_INDEX.get(character);
        if (digit === undefined) return null;
        decoded = decoded * 58n + BigInt(digit);
    }

    let hex = decoded.toString(16);
    if (hex.length % 2 !== 0) hex = `0${hex}`;
    const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
    const leadingZeroes = value.match(/^1*/u)?.[0].length ?? 0;
    return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

export function isValidTronMainnetAddress(value) {
    const address = value.trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(address)) return false;

    const decoded = decodeBase58(address);
    if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;

    const payload = decoded.subarray(0, 21);
    const checksum = decoded.subarray(21);
    return checksum.equals(sha256(sha256(payload)).subarray(0, 4));
}

function normalizeEnvValue(rawValue) {
    const trimmed = rawValue.trim();
    if (
        trimmed.length >= 2 &&
        ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function parseLegacyEnv(content) {
    const values = {};
    for (const line of content.split(/\r?\n/u)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
        if (!match || (match[1] !== ADDRESS_KEY && match[1] !== FINGERPRINT_KEY)) continue;
        values[match[1]] = normalizeEnvValue(match[2]);
    }
    return values;
}

function reportLegacySource(source, values) {
    const address = `${values[ADDRESS_KEY] ?? ''}`.trim();
    const configuredFingerprint = `${values[FINGERPRINT_KEY] ?? ''}`.trim().toLowerCase();
    if (!address && !configuredFingerprint) return false;

    const addressValid = Boolean(address) && isValidTronMainnetAddress(address);
    const fingerprintValid = /^[a-f0-9]{64}$/u.test(configuredFingerprint);
    const fingerprintMatches =
        addressValid && fingerprintValid && fingerprintReceivingAddress(address) === configuredFingerprint;

    process.stdout.write(
        [
            'PAYMENT_LEGACY_CONFIG_SOURCE',
            `source=${JSON.stringify(source)}`,
            `address_set=${Boolean(address)}`,
            `address_valid=${addressValid}`,
            `fingerprint_set=${Boolean(configuredFingerprint)}`,
            `fingerprint_valid=${fingerprintValid}`,
            `fingerprint_matches=${fingerprintMatches}`,
        ].join(' ') + '\n',
    );
    return true;
}

function isCandidateFile(path) {
    const name = basename(path).toLowerCase();
    if (name.endsWith('.example')) return false;
    return (
        name === '.env' ||
        name.startsWith('.env.') ||
        name.endsWith('.env') ||
        name.includes('vendure') ||
        name.includes('kaiyuangouwu') ||
        name === 'dump.pm2'
    );
}

function collectFiles(root, depth = 0, collectedFiles = new Set()) {
    if (!existsSync(root) || depth > MAX_DEPTH) return collectedFiles;

    let entryStat;
    try {
        entryStat = lstatSync(root);
    } catch {
        return collectedFiles;
    }

    if (entryStat.isSymbolicLink()) {
        try {
            return collectFiles(realpathSync(root), depth, collectedFiles);
        } catch {
            return collectedFiles;
        }
    }

    if (entryStat.isFile()) {
        if (isCandidateFile(root) && entryStat.size <= MAX_FILE_BYTES) collectedFiles.add(root);
        return collectedFiles;
    }

    if (!entryStat.isDirectory() || SKIPPED_DIRECTORIES.has(basename(root))) return collectedFiles;

    let entries = [];
    try {
        entries = readdirSync(root);
    } catch {
        return collectedFiles;
    }
    for (const entry of entries) collectFiles(join(root, entry), depth + 1, collectedFiles);
    return collectedFiles;
}

function inspectLegacyFile(path) {
    try {
        if (statSync(path).size > MAX_FILE_BYTES) return false;
        const content = readFileSync(path, 'utf8');
        if (basename(path) === 'dump.pm2') {
            const processes = JSON.parse(content);
            return (Array.isArray(processes) ? processes : []).some(processRecord =>
                reportLegacySource(
                    `pm2-dump:${processRecord?.name ?? 'unknown'}`,
                    processRecord?.pm2_env ?? {},
                ),
            );
        }
        return reportLegacySource(`file:${path}`, parseLegacyEnv(content));
    } catch {
        return false;
    }
}

function loadRunningPm2Processes() {
    const result = spawnSync('sudo', ['-H', '-u', 'ubuntu', 'bash', '-lc', 'pm2 jlist'], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout.trim()) {
        throw new Error('running PM2 environment is unavailable');
    }
    try {
        const processes = JSON.parse(result.stdout);
        if (!Array.isArray(processes)) throw new Error('not an array');
        return processes;
    } catch {
        throw new Error('running PM2 environment cannot be parsed');
    }
}

export function selectConsistentRuntimeEnvironment(processes) {
    const environments = RUNTIME_PROCESS_NAMES.map(name => {
        const processRecord = processes.find(record => record?.name === name);
        if (!processRecord?.pm2_env || processRecord.pm2_env.status !== 'online') {
            throw new Error(`required production process is not online: ${name}`);
        }
        return { name, values: processRecord.pm2_env };
    });

    for (const key of RUNTIME_KEYS) {
        const runtimeValues = environments.map(runtimeProcess =>
            `${runtimeProcess.values[key] ?? ''}`.trim(),
        );
        if (key !== 'USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS' && runtimeValues.some(value => !value)) {
            throw new Error(`required runtime setting is missing: ${key}`);
        }
        if (new Set(runtimeValues).size !== 1) {
            throw new Error(`API and worker runtime settings differ: ${key}`);
        }
    }

    const environment = environments[0].values;
    const currentSecret = `${environment.USDT_WALLET_ENCRYPTION_KEY}`.trim();
    const previousSecrets = `${environment.USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS ?? ''}`
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    const keyRing = [currentSecret, ...previousSecrets];
    if (keyRing.some(secret => !isAcceptableWalletSecret(secret))) {
        throw new Error('runtime wallet encryption key ring contains an unacceptable secret');
    }
    if (new Set(keyRing).size !== keyRing.length) {
        throw new Error('runtime wallet encryption key ring contains duplicate secrets');
    }
    const paymentProofSecret = `${environment.USDT_PAYMENT_PROOF_SECRET}`.trim();
    if (!isAcceptablePaymentProofSecret(paymentProofSecret)) {
        throw new Error('runtime payment proof secret is unacceptable');
    }
    if (keyRing.includes(paymentProofSecret)) {
        throw new Error('runtime payment proof and wallet encryption secrets are not isolated');
    }

    return Object.fromEntries(RUNTIME_KEYS.map(key => [key, `${environment[key] ?? ''}`.trim()]));
}

function decryptPayload(secret, encodedIv, encodedTag, encodedPayload) {
    if (!encodedIv || !encodedTag || !encodedPayload) {
        throw new Error('wallet ciphertext is incomplete');
    }
    const decipher = createDecipheriv(
        'aes-256-gcm',
        walletEncryptionKey(secret),
        Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encodedPayload, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

function decryptWalletAddress(ciphertext, keyRing) {
    const parts = ciphertext.split(':');
    if (parts[0] === 'v2' && parts.length === 5) {
        const [, keyId, encodedIv, encodedTag, encodedPayload] = parts;
        const secret = keyRing.find(candidate => walletEncryptionKeyId(candidate) === keyId);
        if (!secret) throw new Error('wallet ciphertext key is unavailable');
        return decryptPayload(secret, encodedIv, encodedTag, encodedPayload);
    }
    if (parts[0] === 'v1' && parts.length === 4) {
        const [, encodedIv, encodedTag, encodedPayload] = parts;
        for (const secret of keyRing) {
            try {
                return decryptPayload(secret, encodedIv, encodedTag, encodedPayload);
            } catch {
                // Continue through the reviewed key ring without exposing key material.
            }
        }
    }
    throw new Error('wallet ciphertext is malformed or cannot be decrypted');
}

function inspectEncryptedWallet(ciphertext, configuredFingerprint, keyRing) {
    const encrypted = `${ciphertext ?? ''}`.trim();
    const fingerprint = `${configuredFingerprint ?? ''}`.trim().toLowerCase();
    if (!encrypted && !fingerprint) return { present: false, valid: true, currentKey: true };
    if (!encrypted || !/^[a-f0-9]{64}$/u.test(fingerprint)) {
        return { present: true, valid: false, currentKey: false };
    }

    try {
        const address = decryptWalletAddress(encrypted, keyRing);
        const valid =
            isValidTronMainnetAddress(address) && fingerprintReceivingAddress(address) === fingerprint;
        const [version, keyId] = encrypted.split(':');
        return {
            present: true,
            valid,
            currentKey: valid && version === 'v2' && keyId === walletEncryptionKeyId(keyRing[0]),
        };
    } catch {
        return { present: true, valid: false, currentKey: false };
    }
}

export function auditChannelWalletRows(rows, environment) {
    const currentSecret = `${environment.USDT_WALLET_ENCRYPTION_KEY ?? ''}`.trim();
    const previousSecrets = `${environment.USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS ?? ''}`
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    const keyRing = [currentSecret, ...previousSecrets];
    if (keyRing.some(secret => !isAcceptableWalletSecret(secret))) {
        throw new Error('wallet encryption key ring is unavailable for integrity validation');
    }

    const result = {
        channels: rows.length,
        active: 0,
        pending: 0,
        unconfigured: 0,
        rejected: 0,
        integrityFailures: 0,
        reencryptNeeded: 0,
    };

    for (const row of rows) {
        const [reviewStatus, activeCiphertext, activeFingerprint, pendingCiphertext, pendingFingerprint] =
            row;
        const active = inspectEncryptedWallet(activeCiphertext, activeFingerprint, keyRing);
        const pending = inspectEncryptedWallet(pendingCiphertext, pendingFingerprint, keyRing);
        let rowInvalid = !REVIEW_STATUSES.has(reviewStatus) || !active.valid || !pending.valid;

        if (reviewStatus === 'ACTIVE' && (!active.present || pending.present)) rowInvalid = true;
        if (reviewStatus === 'PENDING' && !pending.present) rowInvalid = true;
        if (
            (reviewStatus === 'UNCONFIGURED' || reviewStatus === 'REJECTED') &&
            (active.present || pending.present)
        ) {
            rowInvalid = true;
        }

        if (active.present && active.valid) result.active += 1;
        if (pending.present && pending.valid) result.pending += 1;
        if (!active.present && !pending.present && reviewStatus === 'UNCONFIGURED') result.unconfigured += 1;
        if (reviewStatus === 'REJECTED') result.rejected += 1;
        if (active.present && active.valid && !active.currentKey) result.reencryptNeeded += 1;
        if (pending.present && pending.valid && !pending.currentKey) result.reencryptNeeded += 1;
        if (rowInvalid) result.integrityFailures += 1;
    }

    return result;
}

function loadChannelWalletRows(environment) {
    const query = [
        'SELECT',
        "COALESCE(w.reviewStatus, 'UNCONFIGURED'),",
        "COALESCE(w.activeReceivingAddressEncrypted, ''),",
        "COALESCE(w.activeReceivingAddressFingerprint, ''),",
        "COALESCE(w.pendingReceivingAddressEncrypted, ''),",
        "COALESCE(w.pendingReceivingAddressFingerprint, '')",
        'FROM channel AS c',
        'LEFT JOIN store_usdt_wallet AS w ON w.channelId = c.id',
        'ORDER BY c.id',
    ].join(' ');
    const result = spawnSync(
        'mysql',
        [
            `--host=${environment.DB_HOST}`,
            `--port=${environment.DB_PORT}`,
            `--user=${environment.DB_USERNAME}`,
            '--batch',
            '--raw',
            '--skip-column-names',
            `--execute=${query}`,
            environment.DB_NAME,
        ],
        {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, MYSQL_PWD: environment.DB_PASSWORD },
        },
    );
    if (result.status !== 0) throw new Error('production Channel wallet query failed');
    return parseChannelWalletRows(result.stdout);
}

export function parseChannelWalletRows(output) {
    if (!output.trim()) throw new Error('production Channel wallet query returned no Channels');
    return output
        .replace(/\r?\n$/u, '')
        .split(/\r?\n/u)
        .map(line => {
            const fields = line.split('\t');
            if (fields.length !== 5) {
                throw new Error('production Channel wallet query returned unsafe data');
            }
            return fields;
        });
}

function runAudit() {
    const processes = loadRunningPm2Processes();
    const runtimeEnvironment = selectConsistentRuntimeEnvironment(processes);
    process.stdout.write(
        'PAYMENT_RUNTIME_ENV api=online worker=online db_consistent=true payment_proof_consistent=true wallet_keyring_consistent=true secret_isolation=true\n',
    );

    const rows = loadChannelWalletRows(runtimeEnvironment);
    const walletAudit = auditChannelWalletRows(rows, runtimeEnvironment);
    process.stdout.write(
        [
            'PAYMENT_CHANNEL_WALLET_AUDIT',
            `channels=${walletAudit.channels}`,
            `active=${walletAudit.active}`,
            `pending=${walletAudit.pending}`,
            `unconfigured=${walletAudit.unconfigured}`,
            `rejected=${walletAudit.rejected}`,
            `integrity_failures=${walletAudit.integrityFailures}`,
            `reencrypt_needed=${walletAudit.reencryptNeeded}`,
        ].join(' ') + '\n',
    );

    const configuredRoots = process.env.AUDIT_PAYMENT_CONFIG_ROOTS?.split(':').filter(Boolean);
    const roots = configuredRoots?.length
        ? configuredRoots
        : [
              '/var/www/kaiyuangouwu',
              '/var/www/kaiyuangouwu-current',
              '/var/www/kaiyuangouwu-releases',
              '/etc/default',
              '/etc/environment',
              '/etc/systemd/system',
              '/home/ubuntu/.pm2/dump.pm2',
          ];
    const files = new Set();
    for (const root of roots) collectFiles(root, 0, files);

    let legacySources = 0;
    for (const processRecord of processes) {
        legacySources += reportLegacySource(
            `pm2-live:${processRecord?.name ?? 'unknown'}`,
            processRecord?.pm2_env ?? {},
        )
            ? 1
            : 0;
    }
    for (const path of [...files].sort()) legacySources += inspectLegacyFile(path) ? 1 : 0;

    process.stdout.write(
        `PAYMENT_CONFIG_AUDIT_COMPLETE channel_wallets_checked=true legacy_files_checked=${files.size} legacy_sources=${legacySources}\n`,
    );
    if (walletAudit.integrityFailures > 0 || walletAudit.reencryptNeeded > 0) {
        throw new Error('Channel wallet integrity or key rotation validation failed');
    }
}

const executedDirectly =
    !process.argv[1] ||
    process.argv[1] === '-' ||
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (executedDirectly) {
    try {
        runAudit();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown audit failure';
        process.stderr.write(`PAYMENT_CONFIG_AUDIT_FAILED reason=${JSON.stringify(message)}\n`);
        process.exitCode = 1;
    }
}

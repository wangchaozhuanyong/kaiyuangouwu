#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
    chownSync,
    closeSync,
    constants,
    fsyncSync,
    lstatSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

const placeholderPattern = /^(?:abc|admin|changeme|example|password|superadmin|vendure-dev|replace[-_])/iu;
const managedKeys = [
    'USDT_PAYMENT_PROOF_SECRET',
    'USDT_WALLET_ENCRYPTION_KEY',
    'TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY',
    'ADMIN_TWO_FACTOR_ENCRYPTION_KEY',
];
const environmentFile = process.argv[2];

if (!environmentFile || !path.isAbsolute(environmentFile) || path.basename(environmentFile) !== '.env') {
    throw new Error('An absolute production .env path is required');
}

if (lstatSync(environmentFile).isSymbolicLink()) {
    throw new Error('Production environment path must not be a symbolic link');
}
const metadata = statSync(environmentFile);
if (!metadata.isFile()) throw new Error('Production environment path must be a regular file');
// POSIX file modes require masking the file-type bits before validating permissions.
// eslint-disable-next-line no-bitwise
const fileMode = metadata.mode & 0o777;
// eslint-disable-next-line no-bitwise
const unsafeMode = fileMode & 0o027;
if (unsafeMode !== 0) {
    throw new Error('Production environment file permissions allow unsafe group or other access');
}

const original = readFileSync(environmentFile, 'utf8');
const entries = parseEnvironment(original);
const previousKeys = splitKeyRing(entries.get('USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS') ?? '');

if (previousKeys.some(value => !isConfiguredSecret(value))) {
    throw new Error('USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS contains a missing, short, or placeholder secret');
}
if (new Set(previousKeys).size !== previousKeys.length) {
    throw new Error('USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS contains duplicate secrets');
}

const currentWalletKey = entries.get('USDT_WALLET_ENCRYPTION_KEY') ?? '';
const walletKey = isConfiguredSecret(currentWalletKey) ? currentWalletKey : createSecret(previousKeys);
if (previousKeys.includes(walletKey)) {
    throw new Error('USDT_WALLET_ENCRYPTION_KEY must not repeat a previous wallet key');
}

const currentProofSecret = entries.get('USDT_PAYMENT_PROOF_SECRET') ?? '';
const proofSecret =
    isConfiguredSecret(currentProofSecret) &&
    currentProofSecret !== walletKey &&
    !previousKeys.includes(currentProofSecret)
        ? currentProofSecret
        : createSecret([walletKey, ...previousKeys]);

const currentDashboardTwoFactorKey = entries.get('TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY') ?? '';
const dashboardTwoFactorKey =
    isConfiguredSecret(currentDashboardTwoFactorKey) &&
    ![walletKey, proofSecret, ...previousKeys].includes(currentDashboardTwoFactorKey)
        ? currentDashboardTwoFactorKey
        : createSecret([walletKey, proofSecret, ...previousKeys]);

const replacements = new Map([
    ['USDT_PAYMENT_PROOF_SECRET', proofSecret],
    ['USDT_WALLET_ENCRYPTION_KEY', walletKey],
    ['TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY', dashboardTwoFactorKey],
]);
const adminLoginKey = entries.get('ADMIN_TWO_FACTOR_ENCRYPTION_KEY') ?? '';
const otherSecrets = [
    ...[...entries].filter(([key]) => key !== 'ADMIN_TWO_FACTOR_ENCRYPTION_KEY').map(([, value]) => value),
    ...replacements.values(),
    ...previousKeys,
];
// A configured login key must never be silently rotated: existing authenticators depend on it.
if (adminLoginKey && !placeholderPattern.test(adminLoginKey)) {
    if (!/^[a-f0-9]{64}$/iu.test(adminLoginKey)) {
        throw new Error('ADMIN_TWO_FACTOR_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters');
    }
    if (otherSecrets.some(value => value.toLowerCase() === adminLoginKey.toLowerCase())) {
        throw new Error('ADMIN_TWO_FACTOR_ENCRYPTION_KEY must be independent of other production secrets');
    }
    replacements.set('ADMIN_TWO_FACTOR_ENCRYPTION_KEY', adminLoginKey);
} else {
    replacements.set('ADMIN_TWO_FACTOR_ENCRYPTION_KEY', createSecret(otherSecrets));
}
const updates = new Map([...replacements].filter(([key, value]) => entries.get(key) !== value));
const updated = replaceEnvironmentValues(original, updates);
const changed = updated !== original;

if (changed) writeAtomically(environmentFile, updated, metadata);

for (const key of managedKeys) {
    const preserved = entries.get(key) === replacements.get(key);
    process.stdout.write(`${key}=${preserved ? 'preserved' : 'initialized'}\n`);
}
process.stdout.write(`environment_file_updated=${changed ? 'yes' : 'no'}\n`);
process.stdout.write('DASHBOARD_TWO_FACTOR_SECRET_INITIALIZATION_OK\n');
process.stdout.write('ADMIN_LOGIN_TWO_FACTOR_SECRET_INITIALIZATION_OK\n');
process.stdout.write('USDT_SECRET_INITIALIZATION_OK\n');

function parseEnvironment(source) {
    const values = new Map();
    for (const line of source.split(/\r?\n/u)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u);
        if (!match) continue;
        values.set(match[1], unquote(match[2]));
    }
    return values;
}

function unquote(value) {
    if (value.length >= 2) {
        const first = value[0];
        const last = value.at(-1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
}

function splitKeyRing(value) {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function isConfiguredSecret(value) {
    return value.length >= 32 && !placeholderPattern.test(value);
}

function createSecret(disallowed) {
    let secret;
    do {
        secret = randomBytes(32).toString('hex');
    } while (disallowed.includes(secret));
    return secret;
}

function replaceEnvironmentValues(source, valuesByKey) {
    const replaced = new Set();
    const lines = source.split(/\r?\n/u).map(line => {
        const match = line.match(/^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)(\s*=).*$/u);
        if (!match || !valuesByKey.has(match[2])) return line;
        replaced.add(match[2]);
        return `${match[1]}${match[2]}${match[3]}${valuesByKey.get(match[2])}`;
    });
    for (const [key, value] of valuesByKey) {
        if (!replaced.has(key)) lines.push(`${key}=${value}`);
    }
    return lines.join('\n');
}

function writeAtomically(target, contents, targetMetadata) {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.usdt-${process.pid}`);
    let descriptor;
    try {
        // eslint-disable-next-line no-bitwise
        descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, fileMode);
        writeFileSync(descriptor, contents, 'utf8');
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        if (process.getuid?.() === 0) chownSync(temporary, targetMetadata.uid, targetMetadata.gid);
        renameSync(temporary, target);
    } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        try {
            unlinkSync(temporary);
        } catch {
            // Best-effort cleanup; retain the original update error.
        }
        throw error;
    }
}

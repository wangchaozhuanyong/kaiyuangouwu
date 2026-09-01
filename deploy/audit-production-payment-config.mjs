#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const ADDRESS_KEY = 'STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS';
const FINGERPRINT_KEY = 'STOREFRONT_USDT_TRC20_ADDRESS_SHA256';
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

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest();
}

function fingerprint(address) {
    return createHash('sha256').update(address, 'utf8').digest('hex');
}

function decodeBase58(value) {
    if (!value) {
        return null;
    }

    let decoded = 0n;
    for (const character of value) {
        const digit = BASE58_INDEX.get(character);
        if (digit === undefined) {
            return null;
        }
        decoded = decoded * 58n + BigInt(digit);
    }

    let hex = decoded.toString(16);
    if (hex.length % 2 !== 0) {
        hex = `0${hex}`;
    }
    const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
    const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
    return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function isValidTronMainnetAddress(value) {
    const address = value.trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
        return false;
    }

    const decoded = decodeBase58(address);
    if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) {
        return false;
    }

    const payload = decoded.subarray(0, 21);
    const checksum = decoded.subarray(21);
    const expected = sha256(sha256(payload)).subarray(0, 4);
    return checksum.equals(expected);
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

function parseEnv(content) {
    const values = {};
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match || (match[1] !== ADDRESS_KEY && match[1] !== FINGERPRINT_KEY)) {
            continue;
        }
        values[match[1]] = normalizeEnvValue(match[2]);
    }
    return values;
}

function report(source, values) {
    if (!(ADDRESS_KEY in values) && !(FINGERPRINT_KEY in values)) {
        return false;
    }

    const address = `${values[ADDRESS_KEY] ?? ''}`.trim();
    const configuredFingerprint = `${values[FINGERPRINT_KEY] ?? ''}`.trim().toLowerCase();
    const addressSet = address.length > 0;
    const addressValid = addressSet && isValidTronMainnetAddress(address);
    const fingerprintSet = configuredFingerprint.length > 0;
    const fingerprintValid = /^[a-f0-9]{64}$/.test(configuredFingerprint);
    const fingerprintMatches =
        addressValid && fingerprintValid && fingerprint(address) === configuredFingerprint;

    process.stdout.write(
        [
            'PAYMENT_CONFIG_SOURCE',
            `source=${JSON.stringify(source)}`,
            `address_set=${addressSet}`,
            `address_valid=${addressValid}`,
            `fingerprint_set=${fingerprintSet}`,
            `fingerprint_valid=${fingerprintValid}`,
            `fingerprint_matches=${fingerprintMatches}`,
        ].join(' ') + '\n',
    );
    return true;
}

function isCandidateFile(path) {
    const name = basename(path).toLowerCase();
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
    if (!existsSync(root) || depth > MAX_DEPTH) {
        return collectedFiles;
    }

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
        if (isCandidateFile(root) && entryStat.size <= MAX_FILE_BYTES) {
            collectedFiles.add(root);
        }
        return collectedFiles;
    }

    if (!entryStat.isDirectory() || SKIPPED_DIRECTORIES.has(basename(root))) {
        return collectedFiles;
    }

    let entries = [];
    try {
        entries = readdirSync(root);
    } catch {
        return collectedFiles;
    }
    for (const entry of entries) {
        collectFiles(join(root, entry), depth + 1, collectedFiles);
    }
    return collectedFiles;
}

function inspectFile(path) {
    try {
        if (statSync(path).size > MAX_FILE_BYTES) {
            return false;
        }
        const content = readFileSync(path, 'utf8');
        if (basename(path) === 'dump.pm2') {
            const processes = JSON.parse(content);
            let found = false;
            for (const processRecord of Array.isArray(processes) ? processes : []) {
                const environment = processRecord?.pm2_env ?? {};
                found = report(`pm2-dump:${processRecord?.name ?? 'unknown'}`, environment) || found;
            }
            return found;
        }
        return report(`file:${path}`, parseEnv(content));
    } catch {
        return false;
    }
}

function inspectRunningPm2() {
    const result = spawnSync('sudo', ['-H', '-u', 'ubuntu', 'bash', '-lc', 'pm2 jlist'], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout.trim()) {
        process.stdout.write('PM2_ENV_AUDIT unavailable=true\n');
        return 0;
    }

    try {
        const processes = JSON.parse(result.stdout);
        let count = 0;
        for (const processRecord of Array.isArray(processes) ? processes : []) {
            count += report(`pm2-live:${processRecord?.name ?? 'unknown'}`, processRecord?.pm2_env ?? {})
                ? 1
                : 0;
        }
        return count;
    } catch {
        process.stdout.write('PM2_ENV_AUDIT parse_failed=true\n');
        return 0;
    }
}

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
for (const root of roots) {
    collectFiles(root, 0, files);
}

let matchingSources = inspectRunningPm2();
for (const path of [...files].sort()) {
    matchingSources += inspectFile(path) ? 1 : 0;
}

process.stdout.write(
    `PAYMENT_CONFIG_AUDIT_COMPLETE files_checked=${files.size} matching_sources=${matchingSources}\n`,
);

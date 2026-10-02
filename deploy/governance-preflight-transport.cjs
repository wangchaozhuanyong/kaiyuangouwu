'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const CHUNK_SIZE = 12000;
const MAX_SIZE = 512000;
const FILE_NAME = 'governance-plan.base64';
const digest = value => createHash('sha256').update(value).digest('hex');

function persist(directory, compressed) {
    assert.equal(realpathSync(directory), path.resolve(directory));
    assert.ok(typeof compressed === 'string' && compressed.length > 0 && compressed.length <= MAX_SIZE);
    assert.match(compressed, /^[A-Za-z0-9+/]+={0,2}$/u);
    writeFileSync(path.join(directory, FILE_NAME), compressed, { flag: 'wx', mode: 0o600 });
    return { directory, sha256: digest(compressed), size: compressed.length, chunkSize: CHUNK_SIZE, partCount: Math.ceil(compressed.length / CHUNK_SIZE) };
}

function readPart(directory, expectedHash, part) {
    assert.match(expectedHash, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(part) && part >= 0);
    assert.equal(realpathSync(directory), path.resolve(directory));
    const fd = openSync(path.join(directory, FILE_NAME), constants.O_RDONLY | constants.O_NOFOLLOW);
    let data;
    try {
        const stat = fstatSync(fd);
        assert.ok(stat.isFile() && stat.size > 0 && stat.size <= MAX_SIZE);
        assert.equal(stat.mode & 0o777, 0o600);
        data = readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
    assert.equal(digest(data), expectedHash, 'Transport snapshot changed');
    assert.ok(part < Math.ceil(data.length / CHUNK_SIZE));
    const content = data.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE);
    return { part, content, sha256: digest(content) };
}

function cleanup(directory, expectedHash) {
    readPart(directory, expectedHash, 0);
    assert.match(directory, /^\/tmp\/vendure-production-operations\.[A-Za-z0-9]+$/u);
    // Only the dedicated mktemp transport directory created by this fixed workflow is removed.
    rmSync(directory, { recursive: true });
}

if (require.main === module) {
    try {
        const [operation, expectedHash, part] = process.argv.slice(2);
        assert.match(__dirname, /^\/tmp\/vendure-production-operations\.[A-Za-z0-9]+$/u);
        if (operation === 'read') {
            assert.equal(process.argv.length, 5);
            assert.match(part, /^(0|[1-9][0-9]{0,2})$/u);
            process.stdout.write(`${JSON.stringify(readPart(__dirname, expectedHash, Number(part)))}\n`);
        } else {
            assert.equal(operation, 'cleanup');
            assert.equal(process.argv.length, 4);
            cleanup(__dirname, expectedHash);
            process.stdout.write('GOVERNANCE_TRANSPORT_CLEANED\n');
        }
    } catch {
        process.stderr.write('GOVERNANCE_TRANSPORT_REJECTED\n');
        process.exitCode = 1;
    }
}

module.exports = { persist, readPart, cleanup };

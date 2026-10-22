'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, lstatSync, readFileSync } = require('node:fs');

const shaPattern = /^[a-f0-9]{40}$/u;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const configPath = 'deploy/nginx/damatong.conf';

function resolveNginxRevision({ backendSha, targetSha, actual, marker }, blob, ancestor) {
    for (const sha of [backendSha, targetSha]) assert.match(sha, shaPattern);
    const candidates = [backendSha];
    if (marker) {
        assert.equal(marker.result, 'PASS', 'Invalid active Nginx receipt');
        assert.match(marker.sourceSha, shaPattern);
        assert.equal(
            marker.configSha256,
            hash(blob(marker.sourceSha)),
            'Nginx marker differs from Git source',
        );
        if (ancestor(backendSha, marker.sourceSha)) candidates.unshift(marker.sourceSha);
        else {
            assert.ok(ancestor(marker.sourceSha, backendSha), 'Nginx/runtime sources diverge');
            candidates.push(marker.sourceSha);
        }
    }
    for (const sourceSha of candidates) {
        if (ancestor(sourceSha, targetSha) && hash(blob(sourceSha)) === hash(actual)) {
            return { sourceSha, configSha256: hash(actual) };
        }
    }
    throw new Error('Active Nginx configuration has unreviewed drift');
}

function inspectNginxRevision(backendSha, targetSha) {
    const file = '/etc/nginx/sites-available/damatong-production';
    const markerFile = '/var/www/kaiyuangouwu-nginx-releases/current.json';
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
    let marker;
    if (existsSync(markerFile)) {
        assert.ok(lstatSync(markerFile).isFile() && !lstatSync(markerFile).isSymbolicLink());
        marker = JSON.parse(readFileSync(markerFile, 'utf8'));
    }
    const git = args =>
        execFileSync(
            process.getuid() === 0 ? 'sudo' : 'git',
            process.getuid() === 0
                ? ['-n', '-H', '-u', 'ubuntu', 'git', '-C', '/var/www/kaiyuangouwu', ...args]
                : ['-C', '/var/www/kaiyuangouwu', ...args],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
    return resolveNginxRevision(
        { backendSha, targetSha, actual: readFileSync(file), marker },
        sha => git(['show', `${sha}:${configPath}`]),
        (before, after) => {
            try {
                git(['merge-base', '--is-ancestor', before, after]);
                return true;
            } catch (error) {
                if (error.status === 1) return false;
                throw new Error('Nginx source ancestry is unavailable');
            }
        },
    );
}

// The SHA must come from native preflight/on-host inspection. Byte equality of
// the exact configuration path is required before removing it from a later diff.
function withoutActiveNginx(paths, { nginxSha, targetSha }, changed) {
    if (!nginxSha || nginxSha === 'unknown' || !paths.includes(configPath)) return paths;
    assert.match(nginxSha, shaPattern);
    assert.match(targetSha, shaPattern);
    const configChanged =
        changed ??
        ((before, after) =>
            Boolean(
                execFileSync(
                    'git',
                    ['diff', '--no-renames', '--name-only', before, after, '--', configPath],
                    { encoding: 'utf8' },
                ).trim(),
            ));
    return configChanged(nginxSha, targetSha) ? paths : paths.filter(file => file !== configPath);
}

module.exports = { inspectNginxRevision, resolveNginxRevision, withoutActiveNginx };
if (require.main === module)
    process.stdout.write(JSON.stringify(inspectNginxRevision(...process.argv.slice(2))) + '\n');

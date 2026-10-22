'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, lstatSync, readFileSync } = require('node:fs');

const shaPattern = /^[a-f0-9]{40}$/u;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const configPath = 'deploy/nginx/damatong.conf';

function activeNginxSources(
    dump,
    resolveFile = realPath => require('node:fs').realpathSync(realPath),
    read = readFileSync,
) {
    const parts = dump.split(/^# configuration file (.+):\n/mu);
    const sources = [];
    for (let i = 1; i < parts.length; i += 2) {
        const file = parts[i];
        if (!/^\/etc\/nginx\/(?:sites-enabled|sites-available|conf\.d)\//u.test(file)) continue;
        if (!/server_name[^;]*(?:moyaoai\.com|damatong\.net|shop\.flashcast\.com\.my)/u.test(parts[i + 1]))
            continue;
        const realPath = resolveFile(file);
        sources.push({
            loadedPath: file,
            realPath,
            configSha256: hash(read(file)),
            expectedTarget: realPath === '/etc/nginx/sites-available/damatong-production',
            hasCoopMap: parts[i + 1].includes('$storefront_html_coop'),
        });
    }
    return sources;
}

// Fixed read-only probes. Certificate validation stays enabled; resolve only
// redirects the TCP connection to the existing local listener, with real SNI.
function inspectNginxRouting(execute = spawnSync) {
    const dump = execute('nginx', ['-T'], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(dump.status, 0, 'Active Nginx source inspection failed');
    const activeSources = activeNginxSources(dump.stdout);
    const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.8078.46 Mobile/15E148 Safari/604.1';
    const originResponses = ['moyaoai.com', 'damatong.net', 'shop.flashcast.com.my'].map(host => {
        const result = execute(
            'curl',
            [
                '--disable',
                '--noproxy',
                '*',
                '--silent',
                '--show-error',
                '--http1.1',
                '--max-time',
                '10',
                '--resolve',
                `${host}:443:127.0.0.1`,
                '--header',
                'Connection: close',
                '--user-agent',
                ua,
                '--dump-header',
                '-',
                '--output',
                '/dev/null',
                `https://${host}/zh/?nginx_origin_probe=readonly`,
            ],
            { encoding: 'utf8', timeout: 12000, maxBuffer: 65536 },
        );
        const headers = {};
        for (const line of String(result.stdout ?? '').split(/\r?\n/u)) {
            const match = /^([^:]+):\s*(.*)$/u.exec(line);
            if (
                match &&
                [
                    'vary',
                    'cross-origin-opener-policy',
                    'cache-control',
                    'content-type',
                    'strict-transport-security',
                ].includes(match[1].toLowerCase())
            ) {
                const name = match[1].toLowerCase();
                headers[name] = headers[name] ? `${headers[name]}, ${match[2]}` : match[2];
            }
        }
        return {
            host,
            tlsVerified: result.status === 0,
            exitCode: result.status,
            status: Number(/^HTTP\/\S+\s+(\d+)/mu.exec(String(result.stdout ?? ''))?.[1] ?? 0),
            headers,
        };
    });
    return { activeSources, originResponses };
}

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

module.exports = {
    activeNginxSources,
    inspectNginxRouting,
    inspectNginxRevision,
    resolveNginxRevision,
    withoutActiveNginx,
};
if (require.main === module)
    process.stdout.write(JSON.stringify(inspectNginxRevision(...process.argv.slice(2))) + '\n');

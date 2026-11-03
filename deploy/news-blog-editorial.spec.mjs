import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const { decodeRequest, assertRuntime, importEditorial } = createRequire(import.meta.url)(
    './news-blog-editorial.cjs',
);
const request = {
    mode: 'publish',
    expectedRuntimeSha: 'a'.repeat(40),
    payload: { requestKey: 'codex-skill:2026-11-03:verified' },
};
test('a content receipt waits for the store shared revision before the worker can close', async () => {
    const receipt = { articleId: '4', version: 3 };
    let releaseCache;
    const pendingCache = new Promise(resolve => {
        releaseCache = resolve;
    });
    const channels = [];
    let finished = false;
    const result = importEditorial(
        { import: async () => receipt },
        {
            invalidate: id => {
                channels.push(id);
                return pendingCache;
            },
        },
        { channelId: 'moyao-channel-id' },
        request.payload,
    ).then(value => {
        finished = true;
        return value;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.deepEqual(channels, ['moyao-channel-id']);
    releaseCache();
    assert.equal(await result, receipt);
    await assert.rejects(
        importEditorial(
            { import: async () => receipt },
            {
                invalidate: async () => {
                    throw new Error('shared cache unavailable');
                },
            },
            { channelId: 'moyao-channel-id' },
            request.payload,
        ),
        /shared cache unavailable/,
    );
});
test('accepts only pinned content operations and bounded existing-article batches', () => {
    for (const mode of ['publish', 'rewrite']) {
        assertRuntime({ ...request, mode }, request.expectedRuntimeSha);
        assert.throws(() => assertRuntime({ ...request, mode }, 'b'.repeat(40)));
    }
    assert.equal(decodeRequest(JSON.stringify(request)).mode, 'publish');
    assert.throws(() => decodeRequest(JSON.stringify({ ...request, mode: 'shell' })));
    assert.throws(() => decodeRequest(JSON.stringify({ ...request, expectedRuntimeSha: 'main' })));
    assert.throws(() =>
        decodeRequest(JSON.stringify({ ...request, mode: 'rewrite', payload: [request.payload] })),
    );
    const entry = { ...request.payload, articleId: '42', expectedVersion: 5 };
    assert.equal(
        decodeRequest(JSON.stringify({ ...request, mode: 'rewrite', payload: [entry] })).payload.length,
        1,
    );
    assert.throws(() =>
        decodeRequest(JSON.stringify({ ...request, mode: 'rewrite', payload: Array(5).fill(entry) })),
    );
    assert.throws(() => decodeRequest(' '.repeat(45001)));
});
test('workflow transports punctuation as data without creating shell commands', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const base = path.join(root, 'backups/blog-skill-editorial-20261103');
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(path.join(base, 'transport-test-'));
    const yaml = readFileSync(path.join(root, '.github/workflows/news_blog_editorial.yml'), 'utf8');
    const block = yaml.split("                  python3 - <<'PY'\n")[1].split('\n                  PY')[0];
    const python = block
        .split('\n')
        .map(line => line.slice(18))
        .join('\n');
    const payload = {
        ...request.payload,
        profile: { purpose: "中文 ' ; $(touch UNEXPECTED_FILE) \u0060echo injected\u0060" },
    };
    const result = spawnSync('python3', ['-c', python], {
        cwd: root,
        encoding: 'utf8',
        env: {
            ...process.env,
            RUNNER_TEMP: directory,
            MODE: 'publish',
            EXPECTED_RUNTIME_SHA: request.expectedRuntimeSha,
            PAYLOAD: JSON.stringify(payload),
        },
    });
    assert.equal(result.status, 0, result.stderr);
    const parameters = JSON.parse(readFileSync(path.join(directory, 'editorial-ssm.json'), 'utf8'));
    const script = parameters.commands.join('\n');
    assert.ok(Buffer.byteLength(script) < 80000);
    assert.ok(!script.includes('$(touch UNEXPECTED_FILE)'));
    assert.equal(spawnSync('bash', ['-n'], { input: script }).status, 0);
    // SSM invokes /bin/sh. Exercise the actual command and its stdin framing, with host actions
    // replaced by isolated test executables rather than touching a real lock, account or runtime.
    const bin = path.join(directory, 'bin');
    const remote = path.join(directory, 'remote');
    const lock = path.join(directory, 'lock');
    const captured = path.join(directory, 'captured.json');
    mkdirSync(bin);
    mkdirSync(remote);
    writeFileSync(lock, '');
    for (const name of ['install', 'chmod', 'python3', 'find', 'mktemp', 'flock', 'sudo']) {
        const body =
            name === 'mktemp'
                ? 'printf "%s\\n" "$TEST_REMOTE"'
                : name === 'flock'
                  ? 'cat > "$TEST_CAPTURE"'
                  : name === 'sudo'
                    ? 'test "$1 $2 $3 $4" = "-n -H -u ubuntu" || exit 88; shift 4; exec "$@"'
                    : 'exit 0';
        const file = path.join(bin, name);
        writeFileSync(file, '#!/bin/sh\n' + body + '\n');
        chmodSync(file, 0o755);
    }
    assert.ok(script.startsWith("/bin/bash <<'NEWS_BLOG_EDITORIAL_SCRIPT'\n"));
    const invocation = spawnSync(
        '/bin/sh',
        ['-c', script.replaceAll('/run/lock/vendure-production-deploy.lock', lock)],
        {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: bin + path.delimiter + process.env.PATH,
                TEST_REMOTE: remote,
                TEST_CAPTURE: captured,
            },
        },
    );
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.deepEqual(JSON.parse(readFileSync(captured, 'utf8')).payload, payload);
    const encoded = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(script)[1];
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()).payload, payload);
});

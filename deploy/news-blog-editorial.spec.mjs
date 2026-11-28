import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

const { decodeRequest, assertRuntime, importEditorial, inspectSkillArticles, encodeInspection } =
    createRequire(import.meta.url)('./news-blog-editorial.cjs');
const request = {
    mode: 'publish',
    expectedRuntimeSha: 'a'.repeat(40),
    payload: { requestKey: 'codex-skill:2026-11-03:verified' },
};
test('inspect includes withdrawn Skill identities and observes only this store', async () => {
    const publishedAt = new Date('2026-11-18T01:09:42.763Z');
    const skill = {
        name: 'style-sampling',
        identity: 'a'.repeat(64),
        repository: 'owner/repo',
        repositoryId: '42',
        directoryUrl: 'https://github.com/owner/repo/tree/' + 'b'.repeat(40) + '/skills/style-sampling',
        sourceCommit: 'b'.repeat(40),
    };
    const snapshot = JSON.stringify({
        category: 'skills',
        title: 'Skill 用途',
        skill,
        skillProfile: { domain: 'media' },
        body: 'Editorial body',
    });
    const draft = JSON.stringify({ ...JSON.parse(snapshot), title: 'Unpublished draft title' });
    const row = { channelId: '2', slug: 'style-sampling', version: 3, publishedAt, draftJson: draft };
    const fixtures = [
        { ...row, id: 125, state: 'WITHDRAWN', publishedCategory: '', publishedJson: null },
        { ...row, id: 124, state: 'DRAFT', publishedCategory: 'skills', publishedJson: snapshot },
        { ...row, id: 123, state: 'DRAFT', publishedAt: null, publishedCategory: '', publishedJson: null },
        {
            ...row,
            id: 122,
            state: 'WITHDRAWN',
            publishedCategory: '',
            publishedJson: null,
            draftJson: JSON.stringify({ category: 'claude' }),
        },
        { ...row, id: 121, channelId: '3', publishedCategory: 'skills', publishedJson: snapshot },
    ];
    const articles = await inspectSkillArticles(
        {
            async find({ where }) {
                return fixtures.filter(candidate =>
                    where.some(clause =>
                        Object.entries(clause).every(([key, value]) => candidate[key] === value),
                    ),
                );
            },
        },
        '2',
    );
    assert.deepEqual(
        articles.map(x => x.id),
        ['125', '124', '123'],
    );
    assert.equal(articles[0].state, 'WITHDRAWN');
    assert.equal(articles[0].publishedAt, publishedAt.toISOString());
    assert.deepEqual(articles[0].skill, skill);
    assert.equal(articles[1].title, 'Skill 用途');
    assert.equal(articles[2].publishedAt, null);
    assert.ok(!JSON.stringify(articles).includes('Unpublished draft title'));
    assert.ok(!JSON.stringify(articles).includes('Editorial body'));
});
test('a realistic history fits within the SSM receipt and round-trips losslessly', () => {
    const inspection = {
        schemaVersion: 1,
        channelCode: 'moyao-ai',
        articles: Array.from({ length: 70 }, (_, index) => ({
            id: String(index),
            title: '格式示例测试文章'.repeat(6) + index,
            state: 'WITHDRAWN',
            publishedAt: '2026-11-18T01:09:42.763Z',
            skill: {
                name: 'example-' + index,
                identity: String(index).padStart(64, '0'),
                directoryUrl: 'https://github.com/owner/repo/tree/' + 'a'.repeat(40) + '/skills/' + index,
                sourceCommit: 'a'.repeat(40),
            },
        })),
    };
    assert.ok(Buffer.byteLength(JSON.stringify(inspection), 'utf8') > 24000);
    const encoded = encodeInspection(inspection);
    assert.ok(Buffer.byteLength('NEWS_BLOG_EDITORIAL_RESULT ' + encoded + '\n', 'utf8') < 24000);
    const envelope = JSON.parse(encoded);
    assert.equal(envelope.encoding, 'gzip-base64');
    const unpacked = gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf8');
    assert.deepEqual(JSON.parse(unpacked), inspection);
});

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

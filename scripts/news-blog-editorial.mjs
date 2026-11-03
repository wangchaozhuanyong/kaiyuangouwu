import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
const args = process.argv.slice(2);
const mode = args[0];
const option = key => args[args.indexOf(key) + 1];
const gh = (parameters, input) =>
    execFileSync('gh', parameters, {
        cwd: root,
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    });
const json = parameters => JSON.parse(gh(parameters));
const repository = 'wangchaozhuanyong/kaiyuangouwu';
assert.ok(
    ['inspect', 'publish', 'rewrite'].includes(mode),
    'Use inspect|publish|rewrite --out <project path>; publish also needs --file and --expected-runtime',
);
assert.ok(args.includes('--out'), 'Explicit project output path required');
const out = path.resolve(option('--out'));
assert.ok(out.startsWith(root + path.sep), 'Output must remain inside this project');
mkdirSync(path.dirname(out), { recursive: true });
assert.ok(
    realpathSync(path.dirname(out)).startsWith(root + path.sep),
    'Output parent must not escape through a symlink',
);
const payload = mode !== 'inspect' ? JSON.parse(readFileSync(path.resolve(option('--file')), 'utf8')) : {};
const expected = mode !== 'inspect' ? option('--expected-runtime') : '';
if (mode !== 'inspect') {
    assert.ok(args.includes('--file') && args.includes('--expected-runtime'));
    assert.match(expected, /^[a-f0-9]{40}$/u);
    const entries = mode === 'rewrite' ? payload : [payload];
    assert.ok(Array.isArray(entries) && entries.length > 0 && entries.length <= 4);
    for (const entry of entries) {
        assert.match(entry.requestKey, /^codex-skill:[a-zA-Z0-9:_-]{8,120}$/u);
        if (mode === 'rewrite') assert.ok(entry.articleId && entry.expectedVersion > 0);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 40000);
}
const requestId = 'editorial-' + randomUUID();
gh(
    ['workflow', 'run', 'news_blog_editorial.yml', '--repo', repository, '--ref', 'main', '--json'],
    JSON.stringify({
        mode,
        request_id: requestId,
        expected_runtime_sha: expected,
        payload: JSON.stringify(payload),
    }),
);
let run;
for (let attempt = 0; attempt < 120; attempt++) {
    const runs = json([
        'run',
        'list',
        '--repo',
        repository,
        '--workflow',
        'news_blog_editorial.yml',
        '--event',
        'workflow_dispatch',
        '--limit',
        '30',
        '--json',
        'databaseId,displayTitle,status,conclusion',
    ]);
    run = runs.find(x => x.displayTitle === 'Skill editorial / ' + requestId);
    if (run?.status === 'completed') break;
    if (attempt % 10 === 0) process.stderr.write('Waiting for editorial receipt ' + requestId + '\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
}
assert.ok(run?.databaseId, 'Dispatch receipt not found; inspect workflow before submitting another request');
assert.equal(run.status, 'completed', 'Workflow is still running; do not dispatch again');
assert.equal(
    run.conclusion,
    'success',
    'Editorial workflow failed; inspect this run before retrying: ' + run.databaseId,
);
const directory = path.join(root, 'backups', 'news-blog-editorial', 'runs', String(run.databaseId));
mkdirSync(directory, { recursive: true });
gh([
    'run',
    'download',
    String(run.databaseId),
    '--repo',
    repository,
    '--name',
    'news-blog-editorial-result',
    '--dir',
    directory,
]);
const result = JSON.parse(readFileSync(path.join(directory, 'editorial-result.json'), 'utf8'));
const line = result.Output.split('\n').find(x => x.startsWith('NEWS_BLOG_EDITORIAL_RESULT '));
assert.ok(line, 'Missing runtime receipt');
const receipt = {
    ...JSON.parse(line.slice('NEWS_BLOG_EDITORIAL_RESULT '.length)),
    workflowRunId: run.databaseId,
};
assert.equal(receipt.channelCode, 'moyao-ai');
writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
assert.equal(
    receipt.failed ?? 0,
    0,
    'Some edits failed; use the saved per-article receipt and retry only unresolved items',
);
process.stdout.write(
    JSON.stringify({ output: out, workflowRunId: run.databaseId, receipt: receipt.receipt ?? null }) + '\n',
);

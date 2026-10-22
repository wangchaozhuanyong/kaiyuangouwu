import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkDiffWhitespace, patchBlankContextLines } from './ci-diff-whitespace.mjs';
import { classifyChanges } from './ci-impact.mjs';

const patch = [
    'diff --git a/file.js b/file.js',
    '--- a/file.js',
    '+++ b/file.js',
    '@@ -1,2 +1,2 @@',
    ' ',
    '-old',
    '+new',
    '',
].join('\n');

function repository(files, check) {
    const directory = mkdtempSync(path.join(tmpdir(), 'vendure-diff-whitespace-'));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = args => execFileSync('git', args, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        git(['init', '--quiet']);
        git(['config', 'user.email', 'fixture@example.invalid']);
        git(['config', 'user.name', 'Fixture']);
        writeFileSync(path.join(directory, 'source.js'), 'const value = 1;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'fixture base']);
        const base = git(['rev-parse', 'HEAD']).toString().trim();
        for (const [name, contents] of Object.entries(files))
            writeFileSync(path.join(directory, name), contents);
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'fixture target']);
        check({ base, cwd: directory });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('accepts only the unchanged empty-line marker in a complete patch hunk', () => {
    repository({ 'vendor.patch': patch }, options => {
        const original = spawnSync('git', ['diff', '--check', options.base, 'HEAD'], { cwd: options.cwd });
        assert.equal(original.status, 2);
        assert.deepEqual(checkDiffWhitespace(options), { status: 0, report: '', validatedContextMarkers: 1 });
    });
});

test('still rejects ordinary source trailing whitespace alongside a valid patch', () => {
    repository({ 'vendor.patch': patch, 'source.js': 'const value = 2; \n' }, options => {
        const result = checkDiffWhitespace(options);
        assert.equal(result.status, 2);
        assert.match(result.report, /source\.js:1: trailing whitespace/u);
    });
});

test('still rejects actual trailing whitespace in added patch source', () => {
    repository({ 'vendor.patch': patch.replace('+new\n', '+new \n') }, options => {
        const result = checkDiffWhitespace(options);
        assert.equal(result.status, 2);
        assert.match(result.report, /vendor\.patch:7: trailing whitespace/u);
    });
});

test('does not exempt spaces outside a patch hunk or malformed/incomplete hunks', () => {
    assert.deepEqual([...patchBlankContextLines(patch)], [5]);
    assert.equal(patchBlankContextLines(patch.replace('@@ -1,2 +1,2 @@', '@@ -1,3 +1,3 @@')).size, 0);
    for (const invalid of [' \n', '@@ -1,1 +1,1 @@\n \n+extra \n', '@@ -1,1 +1,0 @@\n \n']) {
        repository({ 'vendor.patch': invalid }, options =>
            assert.equal(checkDiffWhitespace(options).status, 2),
        );
    }
});

test('does not exempt extra empty lines at EOF in normal source', () => {
    repository({ 'source.js': 'const value = 2;\n\n' }, options => {
        const result = checkDiffWhitespace(options);
        assert.equal(result.status, 2);
        assert.match(result.report, /new blank line at EOF/u);
    });
});

test('preserves conflict-marker diagnostics even alongside valid patch context', () => {
    repository(
        { 'vendor.patch': patch, 'source.js': '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> fixture\n' },
        options => {
            const result = checkDiffWhitespace(options);
            assert.equal(result.status, 2);
            assert.match(result.report, /leftover conflict marker/u);
        },
    );
});

test('invalid revisions fail rather than supply a clean result', () => {
    repository({ 'source.js': 'const value = 2;\n' }, options => {
        assert.throws(() => checkDiffWhitespace({ ...options, base: 'unavailable-fixture-ref' }));
    });
});

test('the whitespace control does not select business packages or deployment', () => {
    const scope = classifyChanges([
        'scripts/ci-diff-whitespace.mjs',
        'scripts/ci-diff-whitespace.spec.mjs',
        '.github/workflows/build_and_test.yml',
    ]);
    assert.equal(scope.controls, true);
    assert.deepEqual(scope.packages, []);
    assert.deepEqual(scope.frontends, []);
    assert.equal(scope.lane, 'none');
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareDesignFiles } from './check-design-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
    'packages/storefront/src/pages/home-page.tsx',
    'packages/storefront/src/styles/desktop-home.css',
    'packages/storefront-content-plugin/src/shared/hero-scene.css',
];
const sources = ref =>
    Object.fromEntries(
        files.map(file => [file, execFileSync('git', ['-C', root, 'show', `${ref}:${file}`])]),
    );
const baseline = sources('bdfa448f');

test('the integrated 2+3 gallery and overlay baseline is accepted', () => {
    assert.deepEqual(compareDesignFiles(baseline, sources('bdfa448f')), []);
});

test('the old main source used by the first preview is rejected', () => {
    assert.deepEqual(compareDesignFiles(baseline, sources('7287128b')), files);
});

test('missing media/layout sources cannot be treated as the current design', () => {
    assert.deepEqual(compareDesignFiles(baseline, { [files[0]]: baseline[files[0]] }), files.slice(1));
});

test('unrelated files do not invalidate this page baseline', () => {
    assert.deepEqual(compareDesignFiles(baseline, { ...baseline, 'unrelated.md': Buffer.from('notes') }), []);
});

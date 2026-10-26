import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { activateFrontends } from './frontend-release.mjs';
import { activateStorefront, switchStorefront } from './storefront-release.mjs';
const base = resolve('reports/realtime-rollback-20261026/filesystem');
mkdirSync(base, { recursive: true });
function fixture() {
    const root = mkdtempSync(resolve(base, 'rollback-'));
    return ['storefront', 'admin'].map(component => {
        const old = resolve(root, `${component}-A`);
        const candidate = resolve(root, `${component}-B`);
        for (const [dir, version] of [
            [old, 'A'],
            [candidate, 'B'],
        ]) {
            mkdirSync(resolve(dir, 'assets'), { recursive: true });
            writeFileSync(resolve(dir, 'index.html'), version);
            writeFileSync(
                resolve(dir, `assets/lazy-${version === 'A' ? 'aaaaaaaa' : 'bbbbbbbb'}.js`),
                `export const version = '${version}';`,
            );
        }
        const pointer = resolve(root, `${component}-current`);
        symlinkSync(old, pointer);
        return { component, old, candidate, pointer };
    });
}
for (const entry of ['storefront', 'frontends']) {
    test(`${entry}: B lazy hash survives failed acceptance and A rollback`, async () => {
        const releases = fixture();
        const active = entry === 'storefront' ? releases.slice(0, 1) : releases;
        const verify = async () => {
            for (const release of active) assert.equal(realpathSync(release.pointer), release.candidate);
            throw new Error('Synthetic acceptance failed after B became visible');
        };
        await assert.rejects(
            entry === 'storefront'
                ? activateStorefront({ ...releases[0], verify })
                : activateFrontends(releases, verify),
            /Synthetic acceptance/,
        );
        for (const release of active) {
            assert.equal(realpathSync(release.pointer), release.old);
            assert.match(
                readFileSync(resolve(release.old, '.compat-assets/assets/lazy-bbbbbbbb.js'), 'utf8'),
                /'B'/,
            );
            assert.equal(readFileSync(resolve(release.old, 'index.html'), 'utf8'), 'A');
        }
    });
}
test('manual A to B to A keeps the B-only lazy hash', () => {
    const [release] = fixture();
    switchStorefront(release.candidate, release.pointer);
    switchStorefront(release.old, release.pointer);
    assert.match(readFileSync(resolve(release.old, '.compat-assets/assets/lazy-bbbbbbbb.js'), 'utf8'), /'B'/);
});

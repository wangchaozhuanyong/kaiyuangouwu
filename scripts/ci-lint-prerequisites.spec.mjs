import assert from 'node:assert/strict';
import test from 'node:test';

import { lintPrerequisiteCommand } from './ci-lint-prerequisites.mjs';

const inventory = [
    'common',
    'core',
    'store-management-plugin',
    'commerce-fulfillment-plugin',
    'next-admin',
].map(directory => ({ directory, name: '@vendure/' + directory, scripts: { build: 'build' } }));
const command = files => lintPrerequisiteCommand({ files }, inventory);
test('builds changed backend declaration owners and their existing dependencies', () => {
    const result = command([
        'packages/commerce-fulfillment-plugin/src/a.ts',
        'packages/store-management-plugin/src/a.ts',
    ]);
    for (const name of ['common', 'core', 'store-management-plugin', 'commerce-fulfillment-plugin'])
        assert.ok(result.includes('@vendure/' + name));
    assert.ok(result.includes('--include-dependencies'));
});
test('uses missing lint files when the evidence plan reuses all other files', () => {
    assert.deepEqual(
        lintPrerequisiteCommand(
            { files: [], lintFiles: ['packages/store-management-plugin/src/a.ts'] },
            inventory,
        ),
        command(['packages/store-management-plugin/src/a.ts']),
    );
});
test('does not build browser applications as lint prerequisites', () => {
    const result = command(['packages/next-admin/src/a.tsx']);
    assert.ok(!result.includes('@vendure/next-admin'));
    assert.ok(result.includes('@vendure/core'));
});
test('deduplicates owners and rejects unsafe or unknown paths', () => {
    assert.equal(
        command(['packages/core/src/a.ts', 'packages/core/src/b.ts']).filter(x => x === '@vendure/core')
            .length,
        1,
    );
    for (const path of ['/private/a.ts', '../a.ts', 'packages/missing/src/a.ts'])
        assert.throws(() => command([path]));
});

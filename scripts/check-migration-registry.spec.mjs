import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeMigrationRegistry } from './check-migration-registry.mjs';

function source(className) {
    return `export class ${className} implements MigrationInterface {}`;
}

test('accepts migrations that are imported, registered once, and ordered', () => {
    const fileNames = ['1780000000000-first.ts', '1780000000001-second.ts'];
    const result = analyzeMigrationRegistry({
        fileNames,
        sources: new Map([
            [fileNames[0], source('First1780000000000')],
            [fileNames[1], source('Second1780000000001')],
        ]),
        indexSource: `
import { First1780000000000 } from './1780000000000-first';
import { Second1780000000001 } from './1780000000001-second';
export const devServerMigrations = [First1780000000000, Second1780000000001];
`,
        allowedDuplicates: new Map(),
    });
    assert.deepEqual(result, { errors: [], migrationCount: 2, registeredCount: 2, orphanCount: 0 });
});

test('rejects unregistered and newly duplicated migrations', () => {
    const fileNames = ['1780000000000-first.ts', '1780000000000-second.ts'];
    const result = analyzeMigrationRegistry({
        fileNames,
        sources: new Map([
            [fileNames[0], source('First1780000000000')],
            [fileNames[1], source('Second1780000000000')],
        ]),
        indexSource: `
import { First1780000000000 } from './1780000000000-first';
export const devServerMigrations = [First1780000000000];
`,
        allowedDuplicates: new Map(),
        allowedOrphans: new Set(),
    });
    assert.ok(result.errors.some(error => error.includes('Second1780000000000')));
    assert.ok(result.errors.some(error => error.includes('timestamp 1780000000000 is duplicated')));
});

test('freezes an explicitly approved historical orphan outside the active registry', () => {
    const fileName = '1780000000000-orphan.ts';
    const result = analyzeMigrationRegistry({
        fileNames: [fileName],
        sources: new Map([[fileName, source('Orphan1780000000000')]]),
        indexSource: 'export const devServerMigrations = [];',
        allowedDuplicates: new Map(),
        allowedOrphans: new Set([fileName]),
    });
    assert.deepEqual(result, { errors: [], migrationCount: 1, registeredCount: 0, orphanCount: 1 });
});

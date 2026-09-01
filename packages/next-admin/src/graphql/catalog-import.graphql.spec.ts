import { describe, expect, it } from 'vitest';

import { canExecuteCatalogImport, type CatalogImportState } from './catalog-import.graphql';

describe('catalog import execution gate', () => {
    it.each([
        ['conflict', { conflictCount: 1, warningCount: 0, errorCount: 0 }],
        ['warning', { conflictCount: 0, warningCount: 1, errorCount: 0 }],
        ['error', { conflictCount: 0, warningCount: 0, errorCount: 1 }],
    ])('blocks execution while any %s row remains unresolved', (_label, counts) => {
        expect(canExecuteCatalogImport(job('PREVIEW_READY', counts), true)).toBe(false);
    });

    it('requires update permission and a preview-ready or retryable state', () => {
        const ready = job('PREVIEW_READY');

        expect(canExecuteCatalogImport(ready, true)).toBe(true);
        expect(canExecuteCatalogImport(job('FAILED'), true)).toBe(true);
        expect(canExecuteCatalogImport(ready, false)).toBe(false);
        expect(canExecuteCatalogImport(job('RUNNING'), true)).toBe(false);
    });
});

function job(state: CatalogImportState, counts = { conflictCount: 0, warningCount: 0, errorCount: 0 }) {
    return { state, ...counts };
}

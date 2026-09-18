// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearAllListSearch,
    clearListSearch,
    getSavedListSearch,
    normalizeSearchString,
    saveListSearch,
} from './list-state-storage';

describe('list-state-storage', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('normalizes search strings correctly', () => {
        expect(normalizeSearchString('')).toBe('');
        expect(normalizeSearchString(null)).toBe('');
        expect(normalizeSearchString(undefined)).toBe('');
        expect(normalizeSearchString('?')).toBe('');
        expect(normalizeSearchString('   ')).toBe('');
        expect(normalizeSearchString('page=2&search=test')).toBe('?page=2&search=test');
        expect(normalizeSearchString('?page=2&search=test')).toBe('?page=2&search=test');
    });

    it('saves and retrieves query for a pathname', () => {
        expect(getSavedListSearch('/catalog/list')).toBeNull();

        saveListSearch('/catalog/list', '?page=3&status=enabled');
        expect(getSavedListSearch('/catalog/list')).toBe('?page=3&status=enabled');

        // Pathnames are isolated
        expect(getSavedListSearch('/sales/orders')).toBeNull();
    });

    it('removes query when saving empty search string', () => {
        saveListSearch('/catalog/list', '?page=3');
        expect(getSavedListSearch('/catalog/list')).toBe('?page=3');

        saveListSearch('/catalog/list', '');
        expect(getSavedListSearch('/catalog/list')).toBeNull();
    });

    it('clears query for specific pathname', () => {
        saveListSearch('/catalog/list', '?page=3');
        saveListSearch('/sales/orders', '?tab=to-fulfill');

        clearListSearch('/catalog/list');
        expect(getSavedListSearch('/catalog/list')).toBeNull();
        expect(getSavedListSearch('/sales/orders')).toBe('?tab=to-fulfill');
    });

    it('clears all list queries', () => {
        saveListSearch('/catalog/list', '?page=3');
        saveListSearch('/sales/orders', '?tab=to-fulfill');
        sessionStorage.setItem('unrelated_key', 'keep_me');

        clearAllListSearch();
        expect(getSavedListSearch('/catalog/list')).toBeNull();
        expect(getSavedListSearch('/sales/orders')).toBeNull();
        expect(sessionStorage.getItem('unrelated_key')).toBe('keep_me');
    });
});

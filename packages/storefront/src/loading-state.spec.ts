import { describe, expect, it } from 'vitest';

import {
    offlineLoadError,
    resolveQueryLoadState,
    storefrontInitialQueryError,
    storefrontQueryPresentation,
} from './loading-state';

describe('query loading state', () => {
    it('treats an empty success and an anonymous null session as resolved data', () => {
        for (const data of [[], null, { items: [], totalItems: 0 }]) {
            expect(storefrontQueryPresentation({ data, error: null, isFetching: true })).toMatchObject({
                hasData: true,
                initialLoading: false,
                refreshing: true,
            });
        }
    });
    it('keeps a failed refresh distinct from an initial failure and a next-page failure', () => {
        const snapshot = { data: [], error: new Error('network'), isError: true };
        expect(storefrontQueryPresentation(snapshot)).toMatchObject({
            initialError: false,
            refreshError: true,
        });
        expect(storefrontInitialQueryError(snapshot, 'zh')).toBe('');
        expect(storefrontQueryPresentation({ ...snapshot, data: undefined })).toMatchObject({
            initialError: true,
            refreshError: false,
        });
        expect(storefrontQueryPresentation({ ...snapshot, isFetchNextPageError: true }).refreshError).toBe(
            false,
        );
    });
    it('shows offline recovery only when the query has no confirmed data', () => {
        expect(storefrontInitialQueryError({ data: undefined, error: null, isPaused: true }, 'en')).toContain(
            'offline',
        );
        expect(storefrontInitialQueryError({ data: [], error: null, isPaused: true }, 'en')).toBe('');
    });
    it('keeps cached data visible during background errors or paused refreshes', () => {
        expect(
            resolveQueryLoadState({ hasData: true, isLoading: false, isPaused: true, isError: false }),
        ).toBe('ready');
        expect(
            resolveQueryLoadState({ hasData: true, isLoading: false, isPaused: false, isError: true }),
        ).toBe('ready');
    });

    it('distinguishes an unresolved offline query from an active first load', () => {
        expect(
            resolveQueryLoadState({ hasData: false, isLoading: false, isPaused: true, isError: false }),
        ).toBe('paused');
        expect(
            resolveQueryLoadState({ hasData: false, isLoading: true, isPaused: false, isError: false }),
        ).toBe('loading');
    });

    it('does not collapse a failed session query into the guest state', () => {
        expect(
            resolveQueryLoadState({ hasData: false, isLoading: false, isPaused: false, isError: true }),
        ).toBe('error');
    });

    it('provides localized offline guidance', () => {
        expect(offlineLoadError('zh')).toContain('网络');
        expect(offlineLoadError('en')).toContain('offline');
    });
});

import { describe, expect, it } from 'vitest';

import { offlineLoadError, resolveQueryLoadState, shouldShowGlobalProgress } from './loading-state';

describe('query loading state', () => {
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

    it('shows global progress for navigation or unresolved first loads only', () => {
        expect(shouldShowGlobalProgress(true, [])).toBe(true);
        expect(shouldShowGlobalProgress(false, [{ data: undefined, fetchStatus: 'fetching' }])).toBe(true);
        expect(shouldShowGlobalProgress(false, [{ data: [], fetchStatus: 'fetching' }])).toBe(false);
        expect(shouldShowGlobalProgress(false, [{ data: undefined, fetchStatus: 'idle' }])).toBe(false);
    });
});

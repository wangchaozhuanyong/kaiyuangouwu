import { describe, expect, it } from 'vitest';

import { offlineLoadError, resolveQueryLoadState } from './loading-state';

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
});

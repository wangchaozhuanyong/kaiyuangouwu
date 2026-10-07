// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicRefreshScheduler } from './public-refresh-scheduler';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
describe('one public refresh owner', () => {
    it('polls every 60 seconds only while visible and SSE disconnected; reconnect reconciles once', () => {
        vi.useFakeTimers();
        let visible = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
            () => visible as DocumentVisibilityState,
        );
        const refresh = vi.fn();
        const owner = publicRefreshScheduler(refresh);
        vi.advanceTimersByTime(59_999);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        owner.connection(true);
        vi.advanceTimersByTime(120_000);
        expect(refresh).toHaveBeenCalledTimes(1);
        owner.connection(false);
        visible = 'hidden';
        vi.advanceTimersByTime(60_000);
        expect(refresh).toHaveBeenCalledTimes(1);
        visible = 'visible';
        owner.connection(true);
        owner.connection(true);
        expect(refresh).toHaveBeenCalledTimes(2);
        owner.dispose();
        window.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(60_000);
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});

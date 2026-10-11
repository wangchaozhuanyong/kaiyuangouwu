// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicRefreshScheduler } from './public-refresh-scheduler';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
describe('one public refresh owner', () => {
    it('reconciles lightweight associations every 30 seconds with SSE while pausing hidden and offline work', () => {
        vi.useFakeTimers();
        let visible = 'visible';
        let online = true;
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
            () => visible as DocumentVisibilityState,
        );
        vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
        const refresh = vi.fn();
        const reconcile = vi.fn();
        const owner = publicRefreshScheduler(refresh, reconcile);
        owner.connection(true);
        vi.advanceTimersByTime(30_000);
        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        visible = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(60_000);
        expect(reconcile).toHaveBeenCalledTimes(1);
        visible = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        expect(reconcile).toHaveBeenCalledTimes(2);
        online = false;
        vi.advanceTimersByTime(60_000);
        expect(reconcile).toHaveBeenCalledTimes(2);
        online = true;
        window.dispatchEvent(new Event('online'));
        expect(reconcile).toHaveBeenCalledTimes(3);
        owner.dispose();
    });
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

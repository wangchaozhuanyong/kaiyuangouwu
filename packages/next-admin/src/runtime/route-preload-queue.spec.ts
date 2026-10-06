import { describe, expect, it, vi } from 'vitest';
import { scheduleRoutePreloads } from './route-preload-queue';

describe('background route preload queue', () => {
    it('waits for the current import and another idle turn, and stops after cancellation', async () => {
        const turns: Array<() => void> = [];
        let finish!: () => void;
        const load = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        const cancelIdle = vi.fn();
        let ready = false;
        const cancel = scheduleRoutePreloads(
            ['/one', '/two', '/three'],
            load,
            () => ready,
            callback => {
                turns.push(callback);
                return cancelIdle;
            },
        );
        turns.shift()!();
        expect(load).not.toHaveBeenCalled();
        ready = true;
        turns.shift()!();
        await Promise.resolve();
        expect(load).toHaveBeenCalledExactlyOnceWith('/one');
        expect(turns).toHaveLength(0);
        finish();
        await vi.waitFor(() => expect(turns).toHaveLength(1));
        turns.shift()!();
        await Promise.resolve();
        expect(load).toHaveBeenCalledTimes(2);
        cancel();
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(turns).toHaveLength(0);
        expect(cancelIdle).toHaveBeenCalledTimes(1);
    });

    it('continues to the next idle import after a failed speculative load', async () => {
        const turns: Array<() => void> = [];
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
        const cancel = scheduleRoutePreloads(
            ['/one', '/two'],
            load,
            () => true,
            callback => {
                turns.push(callback);
                return () => {};
            },
        );
        turns.shift()!();
        await vi.waitFor(() => expect(turns).toHaveLength(1));
        turns.shift()!();
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
        cancel();
    });
});

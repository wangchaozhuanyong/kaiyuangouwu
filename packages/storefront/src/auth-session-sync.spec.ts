import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    authSessionChangeStorageKey,
    publishAuthSessionChange,
    subscribeAuthSessionChanges,
} from './auth-session-sync';

describe('cross-tab authentication session sync', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('publishes a market-scoped signal without storing authentication data', () => {
        const setItem = vi.fn();
        vi.stubGlobal('window', {});
        vi.stubGlobal('localStorage', { setItem });

        publishAuthSessionChange('local-usd');

        expect(setItem).toHaveBeenCalledOnce();
        const [key, value] = setItem.mock.calls[0];
        expect(key).toBe(authSessionChangeStorageKey('local-usd'));
        expect(value).toMatch(/^\d+:/);
        expect(value).not.toContain('token');
    });

    it('subscribes only to the selected market and removes its listener', () => {
        const onChange = vi.fn();
        let listener: ((event: StorageEvent) => void) | undefined;
        const addEventListener = vi.fn((_type: string, nextListener: (event: StorageEvent) => void) => {
            listener = nextListener;
        });
        const removeEventListener = vi.fn();
        vi.stubGlobal('window', { addEventListener, removeEventListener });
        const unsubscribe = subscribeAuthSessionChanges('local-usd', onChange);

        listener?.({
            key: authSessionChangeStorageKey('another-market'),
            newValue: '1:other',
        } as StorageEvent);
        listener?.({
            key: authSessionChangeStorageKey('local-usd'),
            newValue: '2:current',
        } as StorageEvent);
        expect(onChange).toHaveBeenCalledOnce();

        unsubscribe();
        expect(removeEventListener).toHaveBeenCalledWith('storage', listener);
        expect(onChange).toHaveBeenCalledOnce();
    });
});

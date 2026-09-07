import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeAdminFeedback, type AdminFeedback } from './admin-feedback';
import { runVerifiedMutation } from './verified-mutation';

const subscriptions: Array<() => void> = [];

afterEach(() => {
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
});

describe('runVerifiedMutation', () => {
    it('reports success only after the persisted state has been verified', async () => {
        const events = collectFeedback();
        const verify = vi.fn();

        await runVerifiedMutation({
            action: '保存',
            successMessage: '已从服务端回读确认',
            failureMessage: '设置保存失败',
            mutate: async () => ({ value: 'saved' }),
            verify,
        });

        expect(verify).toHaveBeenCalledWith({ value: 'saved' });
        expect(events.map(event => event.kind)).toEqual(['loading', 'success']);
        expect(events[0]?.id).toBe(events[1]?.id);
        expect(events.at(-1)?.message).toBe('已从服务端回读确认');
    });

    it('replaces the pending state with a specific error when verification fails', async () => {
        const events = collectFeedback();

        await expect(
            runVerifiedMutation({
                action: '保存',
                successMessage: '已从服务端回读确认',
                failureMessage: '设置保存失败',
                mutate: async () => ({ value: 'old' }),
                verify: () => {
                    throw new Error('设置未真正保存：默认计税区域仍是旧值');
                },
            }),
        ).rejects.toThrow('默认计税区域仍是旧值');

        expect(events.map(event => event.kind)).toEqual(['loading', 'error']);
        expect(events.at(-1)?.message).toBe('设置未真正保存：默认计税区域仍是旧值');
    });
});

function collectFeedback() {
    const events: AdminFeedback[] = [];
    subscriptions.push(subscribeAdminFeedback(event => events.push(event)));
    return events;
}

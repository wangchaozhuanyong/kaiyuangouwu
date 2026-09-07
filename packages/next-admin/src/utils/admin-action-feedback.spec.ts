import { afterEach, describe, expect, it } from 'vitest';

import { runAdminActionWithFeedback } from './admin-action-feedback';
import { subscribeAdminFeedback, type AdminFeedback } from './admin-feedback';

const subscriptions: Array<() => void> = [];

afterEach(() => {
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
});

describe('runAdminActionWithFeedback', () => {
    it('uses one notification lifecycle for a successful non-Apollo action', async () => {
        const events = collectFeedback();

        await expect(
            runAdminActionWithFeedback({ action: '上传', target: '商品图片' }, async () => 'asset-1'),
        ).resolves.toBe('asset-1');

        expect(events.map(event => event.kind)).toEqual(['loading', 'success']);
        expect(events[0]?.id).toBe(events[1]?.id);
    });

    it('publishes a reason and recovery step when a non-Apollo action fails', async () => {
        const events = collectFeedback();

        await expect(
            runAdminActionWithFeedback({ action: '上传', target: '商品图片' }, async () => {
                throw new Error('Failed to fetch');
            }),
        ).rejects.toThrow('Failed to fetch');

        expect(events.at(-1)).toMatchObject({
            kind: 'error',
            title: '上传商品图片失败',
            reason: '浏览器当前无法连接管理服务',
            resolution: ['检查网络和管理服务状态后重试'],
        });
    });
});

function collectFeedback() {
    const events: AdminFeedback[] = [];
    subscriptions.push(subscribeAdminFeedback(event => events.push(event)));
    return events;
}

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyAdminText, readAdminText } from './admin-clipboard';
import { subscribeAdminFeedback, type AdminFeedback } from './admin-feedback';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('admin clipboard feedback', () => {
    it('reports why copying failed and how the operator can continue', async () => {
        const feedback: AdminFeedback[] = [];
        const unsubscribe = subscribeAdminFeedback(item => feedback.push(item));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')),
            },
        });

        expect(await copyAdminText('secret', '临时密码')).toBe(false);
        expect(feedback.at(-1)).toMatchObject({
            kind: 'error',
            title: '复制临时密码失败',
            reason: '浏览器未允许写入剪贴板',
            resolution: expect.arrayContaining(['或手动选中页面内容进行复制']),
        });
        unsubscribe();
    });

    it('returns clipboard text without publishing a duplicate success notification', async () => {
        const feedback: AdminFeedback[] = [];
        const unsubscribe = subscribeAdminFeedback(item => feedback.push(item));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue('value') },
        });

        expect(await readAdminText('2FA 密钥')).toBe('value');
        expect(feedback).toEqual([]);
        unsubscribe();
    });
});

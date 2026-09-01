import { describe, expect, it } from 'vitest';

import { getStatusLabel, getTranslationStatusLabel } from './status-labels';

describe('status label helpers', () => {
    it.each([
        ['AUTO_TRANSLATED', '已自动翻译'],
        ['MANUAL_LOCKED', '人工翻译已锁定'],
        ['STALE', '英文待复核'],
        ['FAILED', '翻译失败'],
    ])('localizes translation status %s', (status, expected) => {
        expect(getTranslationStatusLabel(status)).toBe(expected);
    });

    it.each([
        ['ACTIVE', '已启用'],
        ['RUNNING', '处理中'],
        ['Settled', '已结算'],
        ['Delivered', '已交付'],
    ])('localizes shared status %s', (status, expected) => {
        expect(getStatusLabel(status)).toBe(expected);
    });

    it('uses a Chinese fallback instead of exposing a new backend enum', () => {
        expect(getStatusLabel('NEW_BACKEND_STATE')).toBe('未知状态');
        expect(getTranslationStatusLabel('NEW_TRANSLATION_STATE')).toBe('未知状态');
    });
});

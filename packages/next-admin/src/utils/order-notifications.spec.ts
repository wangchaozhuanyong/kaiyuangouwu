import { describe, expect, it } from 'vitest';
import { orderNotificationLanguage } from './order-notifications';

describe('announcement language', () => {
    it.each(['en', 'en-US', 'en_GB', 'EN-MY'])('uses English for %s', language => {
        expect(orderNotificationLanguage(language)).toBe('en');
    });
    it.each(['zh-CN', 'zh_Hans', 'zh-TW', ''])('keeps Chinese for %s', language => {
        expect(orderNotificationLanguage(language)).toBe('zh');
    });
});

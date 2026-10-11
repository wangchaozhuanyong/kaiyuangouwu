import { describe, expect, it } from 'vitest';
import { orderAnnouncementText, orderNotificationLanguage } from './order-notifications';

describe('announcement language', () => {
    it.each(['en', 'en-US', 'en_GB', 'EN-MY'])('uses English for %s', language => {
        expect(orderNotificationLanguage(language)).toBe('en');
    });
    it.each(['zh-CN', 'zh_Hans', 'zh-TW', ''])('keeps Chinese for %s', language => {
        expect(orderNotificationLanguage(language)).toBe('zh');
    });
});

describe('configured store announcement', () => {
    const store = { nameZh: '测试网店', nameEn: 'Fixture Store' };
    it('uses the actual localized name for placements and pending reminders', () => {
        expect(orderAnnouncementText('zh', 'order-placed', store)).toBe('测试网店有新的订单，请您查看。');
        expect(orderAnnouncementText('en', 'order-pending', store)).toBe(
            'Fixture Store has pending orders. Please process them promptly.',
        );
    });
    it('keeps legacy unnamed notifications and never invents another-language store name', () => {
        expect(orderAnnouncementText('zh', 'order-pending')).toBe('您有未处理的订单，请您及时处理。');
        expect(orderAnnouncementText('en', 'order-placed', { nameZh: '测试网店' })).toBe(
            'You have a new order. Please check it.',
        );
    });
});

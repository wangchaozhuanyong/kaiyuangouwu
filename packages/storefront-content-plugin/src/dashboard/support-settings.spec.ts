import { describe, expect, it } from 'vitest';

import { ContentBlock, ContentItem } from './storefront-content.graphql';
import {
    prepareSupportDraft,
    supportChannelKey,
    supportItems,
    supportServiceTime,
    validateSupportDraft,
} from './support-settings';

function supportBlock(items: ContentItem[] = []): ContentBlock {
    return {
        code: 'storefront-support',
        internalName: '客服配置',
        type: 'SUPPORT',
        layoutVariant: 'RICH_TEXT',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [
            {
                languageCode: 'zh_Hans',
                title: '客服配置',
                subtitle: '',
                body: '',
                ctaLabel: '',
            },
        ],
        items,
    };
}

function legacyItem(label: string): ContentItem {
    return {
        enabled: true,
        position: 0,
        imageAsset: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [{ languageCode: 'zh_Hans', label, description: '旧版说明' }],
    };
}

describe('support settings', () => {
    it('creates the five required channels without deleting unmatched legacy items', () => {
        const prepared = prepareSupportDraft(supportBlock([legacyItem('旧版电话客服')]));

        expect(supportItems(prepared).map(entry => entry.channel.key)).toEqual([
            'WECHAT',
            'QQ',
            'WHATSAPP',
            'TELEGRAM',
            'QQ_GROUP',
        ]);
        expect(prepared.items).toHaveLength(6);
        expect(prepared.items[5].translations[0].label).toBe('旧版电话客服');
        expect(prepared.items[1].translations[0].description).toBe('');
        expect(supportServiceTime(prepared)).toMatchObject({
            daysZh: '每日',
            startTime: '09:00',
            endTime: '18:00',
        });
    });

    it('recognizes legacy channel labels before settings are present', () => {
        expect(supportChannelKey(legacyItem('微信客服'))).toBe('WECHAT');
        expect(supportChannelKey(legacyItem('QQ群'))).toBe('QQ_GROUP');
        expect(supportChannelKey(legacyItem('Telegram'))).toBe('TELEGRAM');
    });

    it('requires an uploaded WeChat QR code for an enabled WeChat channel', () => {
        const prepared = prepareSupportDraft(supportBlock());
        prepared.items[0] = { ...prepared.items[0], enabled: true };

        expect(validateSupportDraft(prepared, true)).toBe('启用微信客服前请上传二维码');
    });

    it('accepts a configured direct-link channel', () => {
        const prepared = prepareSupportDraft(supportBlock());
        prepared.items[1] = {
            ...prepared.items[1],
            enabled: true,
            targetType: 'URL',
            targetValue: 'https://wpa.qq.com/msgrd?v=3&uin=123456',
        };

        expect(validateSupportDraft(prepared, true)).toBeNull();
    });

    it('rejects a malformed saved link even when its channel is disabled', () => {
        const prepared = prepareSupportDraft(supportBlock());
        prepared.items[1] = {
            ...prepared.items[1],
            enabled: false,
            targetType: 'URL',
            targetValue: 'qq://invalid-link',
        };
        prepared.items[2] = {
            ...prepared.items[2],
            enabled: true,
            targetType: 'URL',
            targetValue: 'https://wa.me/8613800000000',
        };

        expect(validateSupportDraft(prepared, true)).toContain('QQ客服');
    });
});

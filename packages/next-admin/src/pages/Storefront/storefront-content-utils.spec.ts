import { describe, expect, it } from 'vitest';

import {
    cloneContentBlock,
    fromLocalDateTime,
    newContentBlock,
    normalizeSupportAccount,
    storefrontBlockInput,
    storefrontBlockValidation,
    supportLinkFromAccount,
} from './storefront-content-utils';

function validSupportBlock() {
    const block = newContentBlock('SUPPORT', 0);
    const qq = block.items.find(item => item.settings?.supportChannel === 'QQ');
    if (!qq) throw new Error('QQ support fixture is missing');
    qq.enabled = true;
    qq.targetType = 'URL';
    qq.targetValue = 'https://wpa.qq.com/msgrd?v=3&uin=123456789&site=qq&menu=yes';
    qq.settings = { ...(qq.settings ?? {}), supportAccount: '123456789' };
    return block;
}

describe('storefront support content editor', () => {
    it('hydrates legacy missing service hours before validation and save', () => {
        const block = validSupportBlock();
        const qq = block.items.find(item => item.settings?.supportChannel === 'QQ');
        if (!qq) throw new Error('QQ support fixture is missing');
        qq.targetType = 'NONE';
        qq.settings = { supportChannel: 'QQ' };
        const draft = cloneContentBlock({ ...block, settings: null });

        expect(draft.settings).toMatchObject({
            serviceDaysZh: '每日',
            serviceDaysEn: 'Daily',
            serviceStartTime: '09:00',
            serviceEndTime: '18:00',
        });
        expect(draft.items.find(item => item.settings?.supportChannel === 'QQ')?.targetType).toBe('URL');
        expect(draft.items.find(item => item.settings?.supportChannel === 'QQ')?.settings).toMatchObject({
            supportAccount: '123456789',
        });
        expect(storefrontBlockValidation(draft)).toBeNull();
    });

    it('generates standard links from customer-service accounts', () => {
        expect(supportLinkFromAccount('QQ', '123456789')).toBe(
            'https://wpa.qq.com/msgrd?v=3&uin=123456789&site=qq&menu=yes',
        );
        expect(supportLinkFromAccount('WHATSAPP', '+60 12-345 6789')).toBe('https://wa.me/60123456789');
        expect(supportLinkFromAccount('TELEGRAM', '@flashcast_support')).toBe(
            'https://t.me/flashcast_support',
        );
        expect(normalizeSupportAccount('TELEGRAM', 'https://t.me/flashcast_support')).toBe(
            'flashcast_support',
        );

        const block = validSupportBlock();
        const qq = block.items.find(item => item.settings?.supportChannel === 'QQ');
        if (!qq) throw new Error('QQ support fixture is missing');
        qq.targetValue = 'https://example.com/outdated-link';
        const input = storefrontBlockInput(block);
        expect(input.items.find(item => item.settings?.supportChannel === 'QQ')?.targetValue).toBe(
            'https://wpa.qq.com/msgrd?v=3&uin=123456789&site=qq&menu=yes',
        );
    });

    it('does not let a disabled incomplete support channel block saving', () => {
        const block = validSupportBlock();
        const whatsapp = block.items.find(item => item.settings?.supportChannel === 'WHATSAPP');
        if (!whatsapp) throw new Error('WhatsApp support fixture is missing');
        whatsapp.enabled = false;
        whatsapp.targetType = 'URL';
        whatsapp.targetValue = null;
        whatsapp.translations = whatsapp.translations.map(translation => ({
            ...translation,
            label: '',
        }));

        expect(storefrontBlockValidation(block)).toBeNull();
    });

    it('keeps an empty display schedule as permanent', () => {
        const draft = cloneContentBlock(validSupportBlock());
        draft.startsAt = fromLocalDateTime('');
        draft.endsAt = fromLocalDateTime('');

        expect(storefrontBlockValidation(draft)).toBeNull();
        expect(storefrontBlockInput(draft)).toMatchObject({ startsAt: null, endsAt: null });
    });

    it('rejects an invalid display schedule', () => {
        const draft = cloneContentBlock(validSupportBlock());
        draft.startsAt = '2026-09-05T10:00:00.000Z';
        draft.endsAt = '2026-09-05T09:00:00.000Z';

        expect(storefrontBlockValidation(draft)).toBe('结束展示时间必须晚于开始展示时间');
    });

    it('requires a QR image for enabled WeChat support', () => {
        const block = newContentBlock('SUPPORT', 0);
        const wechat = block.items.find(item => item.settings?.supportChannel === 'WECHAT');
        if (!wechat) throw new Error('WeChat support fixture is missing');
        wechat.enabled = true;

        expect(storefrontBlockValidation(block)).toBe('启用微信客服前请选择二维码素材');

        wechat.imageUrl = 'https://example.com/wechat-qr.png';
        expect(storefrontBlockValidation(block)).toBeNull();
    });

    it('requires enabled manual support channels to use an http(s) link', () => {
        const block = validSupportBlock();
        const qq = block.items.find(item => item.settings?.supportChannel === 'QQ');
        const qqGroup = block.items.find(item => item.settings?.supportChannel === 'QQ_GROUP');
        if (!qq || !qqGroup) throw new Error('QQ support fixture is missing');
        qq.enabled = false;
        qqGroup.enabled = true;
        qqGroup.targetType = 'URL';
        qqGroup.targetValue = 'javascript:alert(1)';

        expect(storefrontBlockValidation(block)).toContain('有效的 http(s) 网址');
    });
});

it('only submits edited English fields and keeps cleared English explicit', () => {
    const original = newContentBlock('CORE_CATEGORIES', 0);
    const edited = cloneContentBlock(original);
    edited.translations.find(item => item.languageCode === 'zh_Hans')!.title = '中文最新标题';
    expect(storefrontBlockInput(edited, original).translations.map(item => item.languageCode)).toEqual([
        'zh_Hans',
    ]);
    edited.translations.find(item => item.languageCode === 'en')!.title = '';
    expect(
        storefrontBlockInput(edited, original).translations.find(item => item.languageCode === 'en'),
    ).toMatchObject({ title: '', updatedFields: ['title'] });
});

import { describe, expect, it } from 'vitest';

import {
    cloneContentBlock,
    fromLocalDateTime,
    newAccountHeroBlock,
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
    it('uses selected asset IDs without submitting generated preview URLs as external sources', () => {
        const block = validSupportBlock();
        block.imageAssetId = 'selected-banner';
        block.imageUrl = '/assets/banner-preview.webp';
        block.items[0].imageAssetId = 'selected-qr';
        block.items[0].imageUrl = '/assets/qr-preview.webp';
        const input = storefrontBlockInput(block);
        expect(input.imageAssetId).toBe('selected-banner');
        expect(input.imageUrl).toBeNull();
        expect(input.items[0].imageAssetId).toBe('selected-qr');
        expect(input.items[0].imageUrl).toBeNull();
        block.imageAssetId = null;
        block.imageUrl = 'https://images.example.test/external.jpg';
        expect(storefrontBlockInput(block).imageUrl).toBe('https://images.example.test/external.jpg');
    });

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

    it('requires bilingual copy before a support FAQ can be published', () => {
        const block = validSupportBlock();
        const faq = {
            id: 'shipping',
            enabled: true,
            questionZh: '如何确认运费？',
            answerZh: '结算时计算。',
            questionEn: '',
            answerEn: '',
        };
        block.settings = { ...block.settings, supportFaqs: [faq] };

        expect(storefrontBlockValidation(block)).toBe('请填写第 1 条常见问题的中英文问题与答案');
        faq.questionEn = 'How is shipping calculated?';
        faq.answerEn = 'It is calculated at checkout.';
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
    it('keeps cleared auth titles and selling points in the save payload', () => {
        const draft = newContentBlock('AUTH_LOGIN', 0);
        for (const translation of draft.translations) {
            translation.title = '';
            translation.subtitle = '';
            translation.ctaLabel = '';
        }
        for (const item of draft.items) {
            for (const translation of item.translations) translation.label = '';
        }
        expect(storefrontBlockValidation(draft)).toBeNull();
        const input = storefrontBlockInput(draft);
        expect(input.translations).toHaveLength(2);
        expect(input.translations.every(translation => !translation.title)).toBe(true);
        expect(
            input.items.every(
                item =>
                    item.translations.length === 2 &&
                    item.translations.every(translation => !translation.label),
            ),
        ).toBe(true);
    });
});

describe('storefront account hero editor', () => {
    it('creates one publishable reserved block and binds only the selected asset', () => {
        const block = newAccountHeroBlock(7);
        block.imageAsset = {
            id: 'asset-account-hero',
            name: 'account-hero.webp',
            preview: '/assets/preview/account-hero.webp',
            source: '/assets/source/account-hero.webp',
        };

        expect(block).toMatchObject({
            code: 'account-hero-visual',
            type: 'ACCOUNT_HERO',
            layoutVariant: 'HERO_OVERLAY',
            enabled: true,
            position: 7,
            targetType: 'NONE',
            items: [],
        });
        expect(storefrontBlockValidation(block)).toBeNull();
        expect(storefrontBlockInput(block)).toMatchObject({
            imageAssetId: 'asset-account-hero',
            imageUrl: null,
        });
    });
});

it('only submits edited English fields and keeps cleared English explicit', () => {
    const original = newContentBlock('CORE_CATEGORIES', 0);
    original.id = 'persisted-block';
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

it('includes default English copy when a new content block has not been saved', () => {
    const draft = newContentBlock('SUPPORT', 0);
    const input = storefrontBlockInput(draft, draft);

    expect(input.translations.find(item => item.languageCode === 'en')).toMatchObject({ title: 'Support' });
    expect(input.items[0].translations.find(item => item.languageCode === 'en')).toMatchObject({
        label: 'WeChat support',
    });
});

it('does not lock unchanged English defaults to newly edited Chinese copy', () => {
    const original = newContentBlock('SUPPORT', 0);
    const edited = cloneContentBlock(original);
    edited.translations.find(item => item.languageCode === 'zh_Hans')!.title = '自定义客服';
    edited.items[0].translations.find(item => item.languageCode === 'zh_Hans')!.label = '自定义微信客服';

    const input = storefrontBlockInput(edited, original);
    expect(input.translations.find(item => item.languageCode === 'en')?.updatedFields).not.toContain('title');
    expect(input.items[0].translations.find(item => item.languageCode === 'en')?.updatedFields).not.toContain(
        'label',
    );

    edited.translations.find(item => item.languageCode === 'en')!.title = 'Custom support';
    edited.items[0].translations.find(item => item.languageCode === 'en')!.label = 'Custom WeChat support';
    const manuallyTranslated = storefrontBlockInput(edited, original);
    expect(manuallyTranslated.translations.find(item => item.languageCode === 'en')?.updatedFields).toContain(
        'title',
    );
    expect(
        manuallyTranslated.items[0].translations.find(item => item.languageCode === 'en')?.updatedFields,
    ).toContain('label');
});

it('prepares privacy and terms documents in a new legal content block', () => {
    const block = newContentBlock('LEGAL', 0);
    expect(block.enabled).toBe(false);
    expect(block.items.map(item => item.targetValue)).toEqual(['/legal?id=privacy', '/legal?id=terms']);
    expect(
        block.items.map(
            item => item.translations.find(translation => translation.languageCode === 'zh_Hans')?.label,
        ),
    ).toEqual(['隐私政策', '使用条款']);
    expect(storefrontBlockInput(block, block).items.map(item => item.targetType)).toEqual(['PAGE', 'PAGE']);
});

it('rejects enabled core categories with no enabled cards while allowing incomplete drafts', () => {
    const block = newContentBlock('CORE_CATEGORIES', 0);
    expect(storefrontBlockValidation(block)).toBeNull();
    block.enabled = true;
    expect(storefrontBlockValidation(block)).toContain('已启用卡片');
});

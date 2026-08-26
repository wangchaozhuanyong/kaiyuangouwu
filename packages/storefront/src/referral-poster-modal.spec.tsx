import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReferralPosterModal, referralPosterStyles } from './referral-poster-modal';

const expectedTemplateIds = ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD', 'PRODUCT_STORY', 'PREMIUM_DARK'];

describe('referral poster templates', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps four distinct templates aligned with the backend contract', () => {
        expect(referralPosterStyles.map(style => style.id)).toEqual(expectedTemplateIds);
        expect(new Set(referralPosterStyles.map(style => style.background))).toHaveLength(4);
        expect(new Set(referralPosterStyles.map(style => style.nameZh))).toHaveLength(4);
    });

    it('renders all enabled templates and identifies the invite code as optional sharing data', () => {
        vi.stubGlobal('window', { location: { origin: 'https://shop.example.com' } });
        const markup = renderToStaticMarkup(
            createElement(ReferralPosterModal, {
                inviteCode: 'INVITE88',
                storefrontName: '测试商城',
                logoUrl: null,
                language: 'zh',
                rewardRate: 10,
                templates: expectedTemplateIds,
                defaultTemplate: 'BRAND_MINIMAL',
                onClose: vi.fn(),
                onNotify: vi.fn(),
            }),
        );

        expect(markup).toContain('品牌简约');
        expect(markup).toContain('红金礼遇');
        expect(markup).toContain('生活故事');
        expect(markup).toContain('鎏金深色');
        expect(markup).toContain('INVITE88');
        expect(markup).toContain('好友下单后，我可获得 10% 消费奖励');
    });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReferralPosterModal, referralPosterStyles } from './referral-poster-modal';

const expectedTemplateIds = [
    'BRAND_MINIMAL',
    'BENEFIT_RED_GOLD',
    'PRODUCT_STORY',
    'PREMIUM_DARK',
    'CLOUD_BRIDGE_ORBIT',
];

describe('referral poster templates', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps five distinct templates aligned with the backend contract', () => {
        expect(referralPosterStyles.map(style => style.id)).toEqual(expectedTemplateIds);
        expect(new Set(referralPosterStyles.map(style => style.background))).toHaveLength(5);
        expect(new Set(referralPosterStyles.map(style => style.nameZh))).toHaveLength(5);
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

        expect(markup).toContain('云桥简约');
        expect(markup).toContain('冰川蓝光');
        expect(markup).toContain('青空流线');
        expect(markup).toContain('深海科技');
        expect(markup).toContain('云桥轨道');
        expect(markup).toContain('INVITE88');
        expect(markup).toContain('好友成功消费，可获得 10% 奖励用于消费抵扣');
    });
});

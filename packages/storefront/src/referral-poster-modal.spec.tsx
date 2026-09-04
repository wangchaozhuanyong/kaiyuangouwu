import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { posterForegroundColor, ReferralPosterModal, referralPosterStyles } from './referral-poster-modal';
import { readStorefrontStylesheet } from './test-stylesheet';

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
        expect(new Set(referralPosterStyles.map(style => style.pattern))).toHaveLength(5);
        expect(
            new Set(
                referralPosterStyles.map(style =>
                    JSON.stringify([style.colors, style.foreground, style.accent, style.pattern]),
                ),
            ),
        ).toHaveLength(5);
        expect(referralPosterStyles.map(style => style.dark)).toEqual([false, true, true, true, false]);
        expect(referralPosterStyles.find(style => style.id === 'PREMIUM_DARK')?.colors[0]).toBe('#020b1d');
        expect(posterForegroundColor('#f3f8ff', 'deep-sea')).toBe('#f3f8ff');
        expect(posterForegroundColor('#f3f8ff', 'minimal')).toBe('#0E2A63');
        expect(posterForegroundColor('#f8fbff', 'minimal', true)).toBe('#f8fbff');
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

        expect(markup).toContain('模钥简约');
        expect(markup).toContain('冰川蓝光');
        expect(markup).toContain('青空流线');
        expect(markup).toContain('深海科技');
        expect(markup).toContain('模钥轨道');
        expect(markup).toContain('INVITE88');
        expect(markup).toContain('好友成功消费，可获得 10% 奖励用于消费抵扣');
        expect(markup).toContain('poster-templates-scroll');
        expect(markup).toContain('scrollbar-width:none');
        expect(markup).toContain('data-template-id="BRAND_MINIMAL" data-active="true"');
        expect(markup).toContain('data-template-id="BENEFIT_RED_GOLD" data-active="false"');
    });

    it('keeps the poster reachable and unobscured on short mobile viewports', () => {
        vi.stubGlobal('window', { location: { origin: 'https://shop.example.com' } });
        const markup = renderToStaticMarkup(
            createElement(ReferralPosterModal, {
                inviteCode: 'INVITE88',
                storefrontName: 'Test Shop',
                logoUrl: null,
                language: 'en',
                rewardRate: 10,
                templates: expectedTemplateIds,
                defaultTemplate: 'BRAND_MINIMAL',
                onClose: vi.fn(),
                onNotify: vi.fn(),
            }),
        );

        expect(markup).toContain('MOYAO AI minimal');
        expect(markup).toContain('overflow-x-hidden');
        expect(markup).toContain('min-w-0');
        expect(markup).toContain('max-w-sm');
        expect(markup).toContain('flex items-start justify-center');
        expect(markup).toContain('my-auto');
        expect(markup).toContain('pt-14');
        expect(markup).toContain('referral-poster-preview');
        expect(markup).not.toContain('max-h-[54dvh]');
        expect(markup).not.toContain('grid place-items-center');

        const stylesheet = readStorefrontStylesheet(['./styles/modals-and-support.css']);
        expect(stylesheet).toMatch(/\.referral-poster-preview\s*\{[\s\S]*?aspect-ratio:\s*9\s*\/\s*16/);
        expect(stylesheet).toContain('width: min(100%, calc(54dvh * 9 / 16))');
    });

    it('combines custom templates with enabled default templates and omits disabled default templates', () => {
        vi.stubGlobal('window', { location: { origin: 'https://shop.example.com' } });
        const markup = renderToStaticMarkup(
            createElement(ReferralPosterModal, {
                inviteCode: 'INVITE88',
                storefrontName: '测试商城',
                logoUrl: null,
                language: 'zh',
                rewardRate: 10,
                templates: ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD'], // Only 2 default templates enabled
                templateConfigs: [
                    {
                        id: 'custom-poster-1',
                        name: '极客定制海报',
                        enabled: true,
                        position: 0,
                        layoutVariant: 'STANDARD_CENTER',
                        posterBackgroundAsset: null,
                        shareBackgroundAsset: null,
                        titleZh: '专属邀请',
                        titleEn: 'Exclusive Invite',
                        headlineZh: '邀请有礼',
                        headlineEn: 'Invite & Earn',
                        rewardTextZh: '得 10% 奖励',
                        rewardTextEn: 'Earn 10%',
                        siteIntroZh: '介绍',
                        siteIntroEn: 'Intro',
                        serviceTextZh: '服务',
                        serviceTextEn: 'Service',
                        featureOneTitleZh: '特色1',
                        featureOneTitleEn: 'Feature 1',
                        featureOneTextZh: '说明1',
                        featureOneTextEn: 'Desc 1',
                        featureTwoTitleZh: '特色2',
                        featureTwoTitleEn: 'Feature 2',
                        featureTwoTextZh: '说明2',
                        featureTwoTextEn: 'Desc 2',
                        featureThreeTitleZh: '特色3',
                        featureThreeTitleEn: 'Feature 3',
                        featureThreeTextZh: '说明3',
                        featureThreeTextEn: 'Desc 3',
                        qrEyebrowZh: '扫码',
                        qrEyebrowEn: 'Scan',
                        qrTitleZh: '标题',
                        qrTitleEn: 'Title',
                        qrDescriptionZh: '详情',
                        qrDescriptionEn: 'Detail',
                        sceneOneZh: '场景1',
                        sceneOneEn: 'S1',
                        sceneTwoZh: '场景2',
                        sceneTwoEn: 'S2',
                        sceneThreeZh: '场景3',
                        sceneThreeEn: 'S3',
                        sceneFourZh: '场景4',
                        sceneFourEn: 'S4',
                        ctaTextZh: '行动',
                        ctaTextEn: 'CTA',
                        footerTitleZh: '尾款',
                        footerTitleEn: 'Footer',
                        footerTextZh: '文案',
                        footerTextEn: 'Copy',
                        foregroundColor: '#ffffff',
                        accentColor: '#3b82f6',
                        overlayOpacity: 0,
                    },
                ],
                defaultTemplate: 'custom-poster-1',
                onClose: vi.fn(),
                onNotify: vi.fn(),
            }),
        );

        // Custom template is rendered
        expect(markup).toContain('极客定制海报');
        // Enabled default templates are rendered
        expect(markup).toContain('模钥简约');
        expect(markup).toContain('冰川蓝光');
        // Disabled default templates are NOT rendered
        expect(markup).not.toContain('青空流线');
        expect(markup).not.toContain('深海科技');
        expect(markup).not.toContain('模钥轨道');
    });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferralPosterTemplate } from './types';

import {
    availablePosterTemplates,
    posterDomain,
    posterLayoutFields,
    posterRenderKey,
    wrapPosterText,
    type PosterCopy,
} from './referral-poster-layout';
import { ReferralPosterModal } from './referral-poster-modal';
import { readStorefrontStylesheet } from './test-stylesheet';

function template(id: string, name: string, enabled = true): ReferralPosterTemplate {
    const copy = Object.fromEntries(
        posterLayoutFields
            .filter(f => f.field.endsWith('Zh'))
            .flatMap(f => [
                [f.field, '测试文案'],
                [f.field.replace(/Zh$/, 'En'), 'Sample copy'],
            ]),
    ) as PosterCopy;
    return {
        ...copy,
        serviceTextZh: '',
        serviceTextEn: '',
        id,
        name,
        enabled,
        position: 0,
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        foregroundColor: '#152c49',
        accentColor: '#2565ae',
        overlayOpacity: 0,
        rewardTextZh: '邀请获得 {rewardRate}% 奖励',
        rewardTextEn: 'Earn {rewardRate}% rewards',
    };
}
const system = [template('BRAND_MINIMAL', '服务端模板甲'), template('PRODUCT_STORY', '服务端模板乙')];
function markup(systemIds: string[], custom: ReferralPosterTemplate[] = []) {
    return renderToStaticMarkup(
        createElement(ReferralPosterModal, {
            inviteCode: 'INVITE88',
            storefrontName: '测试店铺',
            logoUrl: null,
            language: 'zh',
            rewardRate: 3,
            templates: systemIds,
            systemTemplateConfigs: system,
            templateConfigs: custom,
            defaultTemplate: systemIds[0] ?? '',
            channelId: 'store-a',
            onClose: vi.fn(),
            onNotify: vi.fn(),
        }),
    );
}
describe('referral poster isolation and visibility', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('honours explicit empty configuration without restoring any built-in templates', () => {
        vi.stubGlobal('window', { location: { origin: 'https://store-a.example' } });
        expect(availablePosterTemplates([], system, [])).toEqual([]);
        expect(markup([])).toBe('');
    });
    it('uses server-provided names and only includes enabled system and custom templates', () => {
        vi.stubGlobal('window', { location: { origin: 'https://store-a.example' } });
        const result = markup(
            ['BRAND_MINIMAL'],
            [template('123', '本店模板'), template('456', '已隐藏专属', false)],
        );
        expect(result).toContain('服务端模板甲');
        expect(result).toContain('本店模板');
        expect(result).not.toContain('服务端模板乙');
        expect(result).not.toContain('已隐藏专属');
        expect(result).toContain('邀请获得 3% 奖励');
        for (const previousBrand of ['云桥', 'CloudBridge', 'damatong.net', 'moyaoai.com'])
            expect(result).not.toContain(previousBrand);
    });
    it('retains the existing modal dimensions and scrolling affordance', () => {
        vi.stubGlobal('window', { location: { origin: 'https://store-a.example' } });
        const result = markup(['BRAND_MINIMAL', 'PRODUCT_STORY']);
        for (const cls of [
            'max-w-sm',
            'min-w-0',
            'overflow-x-hidden',
            'poster-templates-scroll',
            'referral-poster-preview',
        ])
            expect(result).toContain(cls);
        expect(readStorefrontStylesheet(['./styles/modals-and-support.css'])).toMatch(
            /aspect-ratio:\s*9\s*\/\s*16/,
        );
    });
    it('invalidates rendered output for every store and content input', () => {
        const input = {
            channelId: 'a',
            shareUrl: 'https://a.example/register?ref=ONE',
            language: 'zh',
            storefrontName: 'A',
            logoUrl: null,
            rewardRate: 3,
            template: system[0],
        };
        const original = posterRenderKey(input);
        const changes = [
            { channelId: 'b' },
            { shareUrl: 'https://b.example/register?ref=TWO' },
            { language: 'en' },
            { storefrontName: 'B' },
            { logoUrl: 'https://a.example/logo.png' },
            { rewardRate: 5 },
            { template: { ...system[0], headlineZh: '新广告' } },
            { template: { ...system[0], updatedAt: '2026-09-06T00:00:00Z' } },
        ];
        for (const change of changes) expect(posterRenderKey({ ...input, ...change })).not.toBe(original);
    });
    it('derives domains from valid share URLs and never substitutes another store', () => {
        expect(posterDomain('https://shop.example:8443/register?ref=X')).toBe('shop.example:8443');
        expect(() => posterDomain('broken')).toThrow();
        expect(() => posterDomain('javascript:alert(1)')).toThrow();
    });
    it('wraps English and Chinese without dropping copy or explicit paragraphs', () => {
        const ctx = { measureText: (value: string) => ({ width: Array.from(value).length * 10 }) } as Pick<
            CanvasRenderingContext2D,
            'measureText'
        >;
        expect(wrapPosterText(ctx, 'Choose better products', 70)).toEqual([
            'Choose',
            'better',
            'product',
            's',
        ]);
        expect(wrapPosterText(ctx, '精选商品与服务', 40)).toEqual(['精选商品', '与服务']);
        expect(wrapPosterText(ctx, 'First\nSecond', 100)).toEqual(['First', 'Second']);
    });
});

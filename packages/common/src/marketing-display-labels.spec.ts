import { describe, expect, it } from 'vitest';

import {
    marketingCampaignLabel,
    marketingReturnMultiple,
    marketingReturnPercent,
    marketingSourceLabel,
} from './marketing-display-labels';
describe('marketing report business labels', () => {
    it('translates tracking codes without changing real business names', () => {
        expect(marketingSourceLabel('direct', '(none)')).toBe('直接访问');
        expect(marketingSourceLabel('google', 'cpc')).toBe('谷歌 · 点击付费广告');
        expect(marketingCampaignLabel('(not set)')).toBe('未标记活动');
        expect(marketingCampaignLabel('Summer 2026')).toBe('Summer 2026');
        expect(marketingSourceLabel('shop.example', 'referral')).toBe('shop.example · 网站引荐');
        expect(marketingSourceLabel('google', 'cpc', 'en')).toBe('google / cpc');
        expect(marketingCampaignLabel('(not set)', 'en')).toBe('(not set)');
    });
    it('distinguishes zero and unavailable returns', () => {
        expect(marketingReturnMultiple(3)).toBe('3.00 倍');
        expect(marketingReturnMultiple(0)).toBe('0.00 倍');
        expect(marketingReturnMultiple(null)).toBe('暂不可计算');
        expect(marketingReturnPercent(-0.25)).toBe('-25.0%');
        expect(marketingReturnPercent(NaN)).toBe('暂不可计算');
        expect(marketingReturnMultiple(3, 'en')).toBe('3.00x');
    });
});

import { describe, expect, it } from 'vitest';

import {
    getCatalogEmptyStateDescription,
    getChannelDisplayLabel,
    getChannelDisplayName,
    isDefaultChannelCode,
} from './channel-display';

describe('channel display helpers', () => {
    it.each(['__default_channel__', '_default_channel_'])(
        'turns the Vendure default channel code into a Chinese store name: %s',
        code => {
            expect(isDefaultChannelCode(code)).toBe(true);
            expect(getChannelDisplayName(code)).toBe('平台管理（不经营）');
        },
    );

    it('keeps merchant-defined store names and adds their currency', () => {
        expect(getChannelDisplayLabel({ code: '美宜佳', defaultCurrencyCode: 'MYR' })).toBe('美宜佳 · MYR');
    });

    it('uses the configured Chinese store name instead of a technical channel code', () => {
        expect(
            getChannelDisplayName({
                code: 'moyao-ai',
                customFields: { storefrontNameZh: '模铝科技' },
            }),
        ).toBe('模铝科技');
    });

    it('explains that an empty catalog only applies to the current store', () => {
        expect(getCatalogEmptyStateDescription({ channelCode: '美宜佳', searchTerm: '' })).toContain(
            '商品、库存和价格按店铺独立显示',
        );
        expect(
            getCatalogEmptyStateDescription({ channelCode: '__default_channel__', searchTerm: '' }),
        ).toContain('“平台管理（不经营）”当前暂无商品');
    });

    it('keeps search-result guidance focused on the search term', () => {
        expect(getCatalogEmptyStateDescription({ channelCode: '美宜佳', searchTerm: '测试商品' })).toBe(
            '未找到与 “测试商品” 相关的商品，请尝试更换关键词。',
        );
    });
});

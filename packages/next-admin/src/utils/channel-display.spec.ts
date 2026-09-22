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

    it('uses an English display name on an English page without exposing the technical code', () => {
        expect(getChannelDisplayName('__default_channel__', 'en')).toBe(
            'Platform management (non-operating)',
        );
        expect(
            getChannelDisplayLabel({ code: '__default_channel__', defaultCurrencyCode: 'CNY' }, 'en'),
        ).toBe('Platform management (non-operating) · CNY');
    });

    it('keeps merchant-defined store names and adds their currency', () => {
        expect(
            getChannelDisplayLabel({
                code: 'my-malaysia',
                defaultCurrencyCode: 'MYR',
                customFields: { storefrontNameZh: '美宜佳' },
            }),
        ).toBe('美宜佳 · MYR');
    });

    it('never exposes a non-default technical code when localized metadata is unavailable', () => {
        expect(getChannelDisplayName('my-malaysia')).toBe('店铺名称不可用');
        expect(getChannelDisplayName('my-malaysia', 'en')).toBe('Store name unavailable');
    });

    it('uses configured store names instead of the technical Channel code', () => {
        const channel = {
            code: 'my-malaysia',
            customFields: { storefrontNameZh: '大马通', storefrontNameEn: 'DAMATONG' },
        };

        expect(getChannelDisplayName(channel, 'zh_Hans')).toBe('大马通');
        expect(getChannelDisplayName(channel, 'en')).toBe('DAMATONG');
    });

    it('does not fall back to the other store language when localized metadata is present', () => {
        expect(
            getChannelDisplayName(
                { code: 'my-malaysia', customFields: { storefrontNameZh: '大马通', storefrontNameEn: '' } },
                'en',
            ),
        ).toBe('English store name not set');
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

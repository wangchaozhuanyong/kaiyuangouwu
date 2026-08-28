import { describe, expect, it } from 'vitest';

import {
    DEFAULT_DUAL_CARD_TEMPLATE_ID,
    applyCoreCategoryDefaults,
    dualCardTemplateId,
    dualCardTemplates,
} from './dual-card-templates';
import { ContentBlock } from './storefront-content.graphql';

function blockFixture(): ContentBlock {
    return {
        code: 'home-core-categories',
        internalName: '首页核心品类',
        type: 'CORE_CATEGORIES',
        layoutVariant: 'CARD_GRID',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [
            { languageCode: 'zh_Hans', title: '', subtitle: '', body: '', ctaLabel: '' },
            { languageCode: 'en', title: '', subtitle: '', body: '', ctaLabel: '' },
        ],
        items: [],
    };
}

describe('dual-card templates', () => {
    it('uses the screenshot template when the stored value is missing or unknown', () => {
        expect(dualCardTemplateId(null)).toBe(DEFAULT_DUAL_CARD_TEMPLATE_ID);
        expect(dualCardTemplateId({ dualCardTemplate: 'unknown' })).toBe(DEFAULT_DUAL_CARD_TEMPLATE_ID);
    });

    it('keeps the default dashboard preview aligned with the light storefront theme', () => {
        const template = dualCardTemplates.find(item => item.id === DEFAULT_DUAL_CARD_TEMPLATE_ID);

        expect(template).toMatchObject({
            labelZh: '清透彩玻',
            cards: [
                { accent: '#079681', border: '#8edfd1' },
                { accent: '#377de8', border: '#a8c9f8' },
            ],
        });
    });

    it('seeds a ready-to-edit pair of cards without requiring catalog IDs', () => {
        const block = applyCoreCategoryDefaults(blockFixture());

        expect(block.settings).toMatchObject({ dualCardTemplate: DEFAULT_DUAL_CARD_TEMPLATE_ID });
        expect(block.translations[0].title).toBe('核心品类精选');
        expect(block.items).toHaveLength(2);
        expect(block.items[0]).toMatchObject({
            targetType: 'PAGE',
            targetValue: 'category',
            settings: {
                badgeLabelZh: '桌面数码',
                ctaLabelZh: '探索硬件',
            },
        });
        expect(block.items[1].translations[0]).toMatchObject({
            label: 'AI 效率与知识资产',
            description: '提示词库、实战课与文案工具',
        });
    });

    it('keeps existing copy and items when adding a missing template setting', () => {
        const existing = blockFixture();
        existing.translations[0].title = '自定义标题';
        existing.items = [
            {
                enabled: true,
                position: 0,
                imageAsset: null,
                imageUrl: null,
                targetType: 'PAGE',
                targetValue: 'search',
                settings: null,
                translations: [
                    { languageCode: 'zh_Hans', label: '自定义卡片', description: '自定义说明' },
                    { languageCode: 'en', label: 'Custom card', description: 'Custom description' },
                ],
            },
        ];

        const block = applyCoreCategoryDefaults(existing);

        expect(block.translations[0].title).toBe('自定义标题');
        expect(block.items).toBe(existing.items);
    });
});

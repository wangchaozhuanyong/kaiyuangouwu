import type { ContentBlock, ContentBlockTranslation, ContentItem } from './storefront-content.graphql';

export const DEFAULT_DUAL_CARD_TEMPLATE_ID = 'tech-duo';

export const dualCardTemplates = [
    {
        id: DEFAULT_DUAL_CARD_TEMPLATE_ID,
        labelZh: '清透彩玻',
        labelEn: 'Aurora Glass',
        descriptionZh: '浅色薄荷青与雾蓝组合，适合 AI 与数字服务',
        descriptionEn: 'Light mint and mist blue for AI and digital services',
        cards: [
            {
                background: 'linear-gradient(145deg, #f4fffb, #f7fffd 52%, #fff8f6)',
                accent: '#079681',
                border: '#8edfd1',
            },
            {
                background: 'linear-gradient(145deg, #f6faff, #f7f8ff 52%, #fff9f6)',
                accent: '#377de8',
                border: '#a8c9f8',
            },
        ],
    },
    {
        id: 'ocean-cobalt',
        labelZh: '深海钴蓝',
        labelEn: 'Ocean Cobalt',
        descriptionZh: '冷静专业，适合数码与企业服务',
        descriptionEn: 'Calm and professional for technology and business services',
        cards: [
            {
                background: 'linear-gradient(145deg, #071d3b, #0b2e59 52%, #0b446f)',
                accent: '#7dd3fc',
                border: '#275f85',
            },
            {
                background: 'linear-gradient(145deg, #111b4d, #192b71 52%, #243c8a)',
                accent: '#bfdbfe',
                border: '#405ca8',
            },
        ],
    },
    {
        id: 'forest-amber',
        labelZh: '森林琥珀',
        labelEn: 'Forest Amber',
        descriptionZh: '沉稳自然，适合家居与生活方式',
        descriptionEn: 'Grounded and natural for home and lifestyle stores',
        cards: [
            {
                background: 'linear-gradient(145deg, #102a24, #14362d 52%, #1b4638)',
                accent: '#6ee7b7',
                border: '#36725d',
            },
            {
                background: 'linear-gradient(145deg, #342213, #432d18 52%, #2a1c14)',
                accent: '#fcd34d',
                border: '#765127',
            },
        ],
    },
    {
        id: 'graphite-lime',
        labelZh: '石墨青柠',
        labelEn: 'Graphite Lime',
        descriptionZh: '利落醒目，适合潮流与运动品类',
        descriptionEn: 'Crisp and energetic for fashion and sports categories',
        cards: [
            {
                background: 'linear-gradient(145deg, #181b20, #22262d 52%, #2c313a)',
                accent: '#bef264',
                border: '#596b3c',
            },
            {
                background: 'linear-gradient(145deg, #111f20, #1d2b2a 52%, #263735)',
                accent: '#5eead4',
                border: '#39726b',
            },
        ],
    },
    {
        id: 'berry-slate',
        labelZh: '莓果雾蓝',
        labelEn: 'Berry Slate',
        descriptionZh: '柔和精致，适合美妆与创意商品',
        descriptionEn: 'Soft and refined for beauty and creative products',
        cards: [
            {
                background: 'linear-gradient(145deg, #31151e, #421b27 52%, #2c1722)',
                accent: '#fda4af',
                border: '#7b3d4c',
            },
            {
                background: 'linear-gradient(145deg, #18212f, #222d3e 52%, #26354a)',
                accent: '#93c5fd',
                border: '#456485',
            },
        ],
    },
] as const;

export type DualCardTemplateId = (typeof dualCardTemplates)[number]['id'];

export function dualCardTemplateId(settings: Record<string, unknown> | null): DualCardTemplateId {
    const value = settings?.dualCardTemplate;
    return dualCardTemplates.some(template => template.id === value)
        ? (value as DualCardTemplateId)
        : DEFAULT_DUAL_CARD_TEMPLATE_ID;
}

export function applyCoreCategoryDefaults(block: ContentBlock): ContentBlock {
    return {
        ...block,
        settings: {
            ...(block.settings ?? {}),
            dualCardTemplate: dualCardTemplateId(block.settings),
        },
        translations: block.translations.map(translation =>
            translation.title.trim() ? translation : defaultBlockTranslation(translation.languageCode),
        ),
        items: block.items.length ? block.items : defaultCoreCategoryItems(),
    };
}

function defaultBlockTranslation(
    languageCode: ContentBlockTranslation['languageCode'],
): ContentBlockTranslation {
    return languageCode === 'zh_Hans'
        ? {
              languageCode,
              title: '核心品类精选',
              subtitle: '',
              body: '',
              ctaLabel: '',
          }
        : {
              languageCode,
              // i18n-audit-ignore -- stored English counterpart selected by languageCode
              title: 'Core Categories',
              subtitle: '',
              body: '',
              ctaLabel: '',
          };
}

function defaultCoreCategoryItems(): ContentItem[] {
    return [
        defaultCoreCategoryItem({
            position: 0,
            badgeZh: '桌面数码',
            badgeEn: 'Desk Gear',
            titleZh: '极简办公工作站',
            titleEn: 'Minimal Workstation',
            descriptionZh: '精选平板、4K显示器与机械键盘',
            descriptionEn: 'Tablets, 4K displays and keyboards',
            ctaZh: '探索硬件',
            ctaEn: 'Explore gear',
        }),
        defaultCoreCategoryItem({
            position: 1,
            badgeZh: '数字生产力',
            badgeEn: 'AI and Digital',
            titleZh: 'AI 效率与知识资产',
            titleEn: 'AI and Knowledge Tools',
            descriptionZh: '提示词库、实战课与文案工具',
            descriptionEn: 'Prompts, toolkits and templates',
            ctaZh: '即刻获取',
            ctaEn: 'Instant access',
        }),
    ];
}

function defaultCoreCategoryItem(input: {
    position: number;
    badgeZh: string;
    badgeEn: string;
    titleZh: string;
    titleEn: string;
    descriptionZh: string;
    descriptionEn: string;
    ctaZh: string;
    ctaEn: string;
}): ContentItem {
    return {
        enabled: true,
        position: input.position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'PAGE',
        targetValue: 'category',
        settings: {
            badgeLabelZh: input.badgeZh,
            badgeLabelEn: input.badgeEn,
            ctaLabelZh: input.ctaZh,
            ctaLabelEn: input.ctaEn,
        },
        translations: [
            {
                languageCode: 'zh_Hans',
                label: input.titleZh,
                description: input.descriptionZh,
            },
            {
                languageCode: 'en',
                label: input.titleEn,
                description: input.descriptionEn,
            },
        ],
    };
}

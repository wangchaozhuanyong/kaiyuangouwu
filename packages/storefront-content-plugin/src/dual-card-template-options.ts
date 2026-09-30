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
        id: 'editorial-home',
        labelZh: '暖居纯色',
        labelEn: 'Warm Tone',
        descriptionZh: '无图片，按店铺皮肤取色',
        descriptionEn: 'Image-free cards using the store palette',
        cards: [
            {
                background: 'linear-gradient(145deg, #faf8f3, #f3eee3)',
                accent: '#8a602e',
                border: '#f3eee3',
            },
            {
                background: 'linear-gradient(145deg, #f7f8f4, #e9eee8)',
                accent: '#536349',
                border: '#e9eee8',
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

export function dualCardTemplateId(settings: Record<string, unknown> | null | undefined): DualCardTemplateId {
    const value = settings?.dualCardTemplate;
    return dualCardTemplates.some(template => template.id === value)
        ? (value as DualCardTemplateId)
        : DEFAULT_DUAL_CARD_TEMPLATE_ID;
}

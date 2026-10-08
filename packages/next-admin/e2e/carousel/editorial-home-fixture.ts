import type { StorefrontContentBlock } from '../../src/graphql/storefront.graphql';

import { newContentBlock } from '../../src/pages/Storefront/storefront-content-utils';

/** Local sample content only. Production artwork and links are configured in Admin. */
export const editorialHomeCopy = [
    {
        key: '01-codex',
        name: 'Codex 主推 · 设计示例',
        zh: [
            'Codex，让开发更顺手',
            'CODEX · AI 编程助手',
            '从理解项目到实现功能，找到适合你的编程账号与订阅。',
            '查看 Codex 商品',
        ],
        en: [
            'Code better with Codex',
            'CODEX · AI CODING',
            'Choose the account or subscription that suits your coding workflow.',
            'Explore Codex',
        ],
        mobileZh: ['让开发，更顺手', 'CODEX · AI 编程助手', '选购适合你的 Codex 账号与订阅。', '查看商品'],
        mobileEn: [
            'Code with Codex',
            'CODEX · AI CODING',
            'Find a Codex account or subscription that fits.',
            'Explore Codex',
        ],
        targetType: 'SEARCH',
        targetValue: 'Codex',
    },
    {
        key: '02-models',
        name: '多模型订阅 · 设计示例',
        zh: [
            '喜欢的模型，一站选购',
            'AI 模型与订阅',
            'ChatGPT、Claude、Gemini、Grok，按需选择适合你的 AI 工具。',
            '浏览 AI 商品',
        ],
        en: [
            'Your favourite models, in one place.',
            'AI MODELS & SUBSCRIPTIONS',
            'Explore ChatGPT, Claude, Gemini and Grok, and choose what works for you.',
            'Browse AI products',
        ],
        mobileZh: ['多款模型，随心选择', 'AI 模型与订阅', 'ChatGPT、Claude、Gemini、Grok。', '浏览商品'],
        mobileEn: [
            'Find your favourite AI',
            'AI MODELS & SUBSCRIPTIONS',
            'Explore ChatGPT, Claude, Gemini and Grok.',
            'Browse AI products',
        ],
        targetType: 'SEARCH',
        targetValue: 'AI',
    },
    {
        key: '03-tools',
        name: '智能工具 · 设计示例',
        zh: [
            '实用工具，少一点繁琐',
            '智能服务与工具',
            '图片创作、动态验证码、邮件查询，让常用能力更好用。',
            '探索智能服务',
        ],
        en: [
            'Useful tools. A simpler workflow.',
            'SMART SERVICES & TOOLS',
            'Create images, generate 2FA codes and look up email in one convenient place.',
            'Explore tools',
        ],
        mobileZh: ['常用工具，轻松打开', '智能服务与工具', '图片创作 · 动态验证码 · 邮件查询', '探索工具'],
        mobileEn: [
            'Tools made easy',
            'SMART SERVICES & TOOLS',
            'Image creation, 2FA codes and email lookup.',
            'Explore tools',
        ],
        targetType: 'PAGE',
        targetValue: 'services',
    },
] as const;

export function editorialHomeBlocks(artworkBase: string): StorefrontContentBlock[] {
    const copy = (languageCode: 'zh_Hans' | 'en', values: readonly string[]) => ({
        languageCode,
        title: values[0],
        subtitle: values[1],
        body: values[2],
        ctaLabel: values[3],
    });
    return editorialHomeCopy.map((entry, position) => {
        const imageUrl = `${artworkBase}/${entry.key}-desktop-v1.png`;
        return {
            ...newContentBlock('HERO', position, entry.name),
            id: `editorial-${entry.key}`,
            code: `editorial-${entry.key}`,
            createdAt: '2026-10-09T00:00:00Z',
            updatedAt: '2026-10-09T00:00:00Z',
            enabled: true,
            backgroundColor: '#f7fbff',
            textColor: '#10253f',
            imageUrl,
            imageAsset: {
                id: `editorial-art-${entry.key}`,
                name: entry.name,
                mimeType: 'image/png',
                source: imageUrl,
                preview: imageUrl,
                width: 1983,
                height: 793,
            },
            settings: {
                heroArtworkLayout: 'editorial',
                themePreset: 'bright',
                secondaryTextColor: '#344b65',
                mobileImageUrl: `${artworkBase}/${entry.key}-mobile-v1.png`,
                mobileImageAssetId: `editorial-mobile-${entry.key}`,
                mobileImageWidth: 1448,
                mobileImageHeight: 1086,
                mobileHeroTranslations: [copy('zh_Hans', entry.mobileZh), copy('en', entry.mobileEn)],
            },
            targetType: entry.targetType,
            targetValue: entry.targetValue,
            translations: [copy('zh_Hans', entry.zh), copy('en', entry.en)],
            items: [],
        };
    });
}

import type { StorefrontContentBlock } from '../../src/graphql/storefront.graphql';

import { newContentBlock, newContentItem } from '../../src/pages/Storefront/storefront-content-utils';

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

export function editorialHomeBlocks(
    artworkBase: string,
    layoutReview = false,
    referenceArtwork?: string,
    deviceArtwork?: {
        desktop: { width: number; height: number };
        mobile: { imageUrl: string; width: number; height: number };
    },
): StorefrontContentBlock[] {
    const copy = (languageCode: 'zh_Hans' | 'en', values: readonly string[]) => ({
        languageCode,
        title: values[0],
        subtitle: values[1],
        body: values[2],
        ctaLabel: values[3],
    });
    const heroes: StorefrontContentBlock[] = editorialHomeCopy.map((entry, position) => {
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
    const referenceCopy = [
        copy('zh_Hans', [
            '多款模型\n一站连接',
            'MOYAO AI · 模钥',
            '探索 ChatGPT、Claude 与 Gemini，让创作与开发更顺手。',
            '探索智能服务',
        ]),
        copy('en', [
            'AI models.\nOne hub.',
            'MOYAO AI',
            'Explore ChatGPT, Claude and Gemini for ideas and code.',
            'Explore AI services',
        ]),
    ];
    // The approved reference has one completed theme. Keep earlier concepts out of its preview.
    const selectedHeroes: StorefrontContentBlock[] = referenceArtwork
        ? [
              {
                  ...heroes[1],
                  id: deviceArtwork ? 'editorial-models-devices-v3' : 'editorial-models-reference-v2',
                  code: deviceArtwork ? 'editorial-models-devices-v3' : 'editorial-models-reference-v2',
                  position: 0,
                  imageUrl: referenceArtwork,
                  imageAsset: {
                      id: 'editorial-art-models-reference-v2',
                      name: deviceArtwork ? '多模型电脑专用 V3' : '原构图多模型 V2',
                      mimeType: 'image/png',
                      source: referenceArtwork,
                      preview: referenceArtwork,
                      width: deviceArtwork?.desktop.width ?? 1983,
                      height: deviceArtwork?.desktop.height ?? 793,
                  },
                  settings: {
                      ...heroes[1].settings,
                      mobileImageUrl: deviceArtwork?.mobile.imageUrl ?? referenceArtwork,
                      mobileImageAssetId: deviceArtwork
                          ? 'editorial-mobile-models-devices-v3'
                          : 'editorial-mobile-models-reference-v2',
                      mobileImageWidth: deviceArtwork?.mobile.width ?? 1983,
                      mobileImageHeight: deviceArtwork?.mobile.height ?? 793,
                      mobileHeroTranslations: [
                          copy('zh_Hans', [
                              '多款模型\n一站连接',
                              'MOYAO AI · 模钥',
                              'ChatGPT · Claude · Gemini',
                              '探索服务',
                          ]),
                          copy('en', [
                              'More AI\nOne hub',
                              'MOYAO AI',
                              'ChatGPT · Claude · Gemini',
                              'Explore AI',
                          ]),
                      ],
                  },
                  targetType: 'PAGE',
                  targetValue: '/services',
                  translations: referenceCopy,
              },
          ]
        : heroes;
    if (!layoutReview) return selectedHeroes;
    const floor = (type: 'QUICK_LINKS' | 'STORY' | 'TRUST_BAR', position: number) => ({
        ...newContentBlock(type, position, '首页布局验收示例'),
        id: `layout-${type.toLowerCase()}`,
        code: `layout-${type.toLowerCase()}`,
        enabled: true,
        createdAt: '2026-10-09T00:00:00Z',
        updatedAt: '2026-10-09T00:00:00Z',
    });
    const labels = [
        ['套餐说明', 'Plan details'],
        ['订单进度', 'Order progress'],
        ['使用提醒', 'Usage guidance'],
        ['售后指引', 'After-sales support'],
    ];
    const trust = {
        ...floor('TRUST_BAR', 30),
        settings: { placement: 'heroOverlay' },
        items: labels.map(([zh, en], position) => ({
            ...newContentItem(position),
            id: `layout-trust-${position}`,
            translations: [
                {
                    languageCode: 'zh_Hans' as const,
                    label: zh,
                    description: '完整的后台服务说明可自然换行显示。',
                },
                {
                    languageCode: 'en' as const,
                    label: en,
                    description:
                        'Complete editable service information wraps naturally in this independent section.',
                },
            ],
        })),
    };
    const story = {
        ...floor('STORY', 20),
        translations: [
            {
                languageCode: 'zh_Hans' as const,
                title: '按需选择 AI 服务',
                subtitle: '',
                body: '本地布局示例：信任区应按照后台排序显示在这个内容区块之后。',
                ctaLabel: '',
            },
            {
                languageCode: 'en' as const,
                title: 'Find the AI service that fits',
                subtitle: '',
                body: 'Local layout example: the service information section follows the saved homepage order.',
                ctaLabel: '',
            },
        ],
    };
    const shortcuts = {
        ...floor('QUICK_LINKS', 10),
        items: ['Codex', 'ChatGPT', 'Gemini'].map((label, position) => ({
            ...newContentItem(position),
            id: `layout-quick-${position}`,
            targetType: 'SEARCH' as const,
            targetValue: label,
            translations: [
                { languageCode: 'zh_Hans' as const, label, description: '' },
                { languageCode: 'en' as const, label, description: '' },
            ],
        })),
    };
    return [...selectedHeroes, shortcuts, story, trust];
}

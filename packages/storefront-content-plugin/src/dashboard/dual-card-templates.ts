import { dualCardTemplateId } from '../dual-card-template-options';

export {
    DEFAULT_DUAL_CARD_TEMPLATE_ID,
    dualCardTemplateId,
    dualCardTemplates,
} from '../dual-card-template-options';
export type { DualCardTemplateId } from '../dual-card-template-options';

type ContentBlock = import('./storefront-content.graphql').ContentBlock;
type ContentBlockTranslation = import('./storefront-content.graphql').ContentBlockTranslation;
type ContentItem = import('./storefront-content.graphql').ContentItem;

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

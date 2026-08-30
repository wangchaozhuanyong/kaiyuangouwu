import {
    STOREFRONT_CLIENT_PLUGINS_CODE,
    StorefrontClientPluginDefinition,
    StorefrontClientPluginPlacement,
    storefrontClientPluginCatalog,
    storefrontClientPluginPlacements,
} from '../client-plugin-manifest';

import { ContentBlock, ContentBlockTranslation, ContentItem } from './storefront-content.graphql';

export const CLIENT_PLUGIN_BLOCK_CODE = STOREFRONT_CLIENT_PLUGINS_CODE;
export const BUSINESS_SERVICES_COPY_VERSION = 1;

export type ClientPluginLanguageCode = 'zh_Hans' | 'en';

export const clientPluginPlacementOptions = [
    {
        value: 'AFTER_HEADER',
        label: '分类页标题下方',
        description: '显示在“选购商品”和搜索框下方。',
    },
    {
        value: 'AFTER_CATEGORY_NAVIGATION',
        label: '分类导航下方',
        description: '显示在一级分类切换区域之后。',
    },
    {
        value: 'BEFORE_PRODUCT_LIST',
        label: '商品列表上方',
        description: '显示在排序筛选栏之后、第一件商品之前。',
    },
    {
        value: 'AFTER_PRODUCT_LIST',
        label: '商品列表下方',
        description: '显示在商品列表和加载更多按钮之后。',
    },
    {
        value: 'BUSINESS_SERVICES_MAIN',
        label: '商业服务页主区域',
        description: '显示在客户端“商业服务”页面的主要内容区域。',
    },
] as const satisfies ReadonlyArray<{
    value: StorefrontClientPluginPlacement;
    label: string;
    description: string;
}>;

export type ClientPluginPlacement = StorefrontClientPluginPlacement;
export type ClientPluginDefinition = StorefrontClientPluginDefinition;
export const clientPluginCatalog = storefrontClientPluginCatalog;

export type ClientPluginCategoryScope = 'ALL' | 'SELECTED';

export interface ClientPluginCategoryRule {
    scope: ClientPluginCategoryScope;
    categoryIds: string[];
    includeChildren: boolean;
}

function blockTranslation(languageCode: ClientPluginLanguageCode): ContentBlockTranslation {
    return {
        languageCode,
        title: languageCode === 'zh_Hans' ? '发现更多商业能力' : 'Discover more business capabilities',
        subtitle: '',
        body:
            languageCode === 'zh_Hans'
                ? '这里展示店铺为你开放的工具、服务和专属权益。'
                : 'Explore tools, services, and benefits enabled by this store.',
        ctaLabel: '',
    };
}

function itemTranslation(
    languageCode: 'zh_Hans' | 'en',
    definition: StorefrontClientPluginDefinition,
): ContentItem['translations'][number] {
    return {
        languageCode,
        label: languageCode === 'zh_Hans' ? definition.name : definition.englishName,
        description: languageCode === 'zh_Hans' ? definition.description : definition.englishDescription,
    };
}

function normalizedBlockTranslations(translations: ContentBlockTranslation[]) {
    return (['zh_Hans', 'en'] as const).map(languageCode => ({
        ...blockTranslation(languageCode),
        ...translations.find(translation => translation.languageCode === languageCode),
        languageCode,
    }));
}

function hasManagedBusinessServicesCopy(block: ContentBlock): boolean {
    return block.settings?.businessServicesCopyVersion === BUSINESS_SERVICES_COPY_VERSION;
}

export function clientPluginPageCopyTranslation(
    block: ContentBlock,
    languageCode: ClientPluginLanguageCode,
): ContentBlockTranslation {
    return (
        block.translations.find(translation => translation.languageCode === languageCode) ??
        blockTranslation(languageCode)
    );
}

export function clientPluginPageCopyIsValid(block: ContentBlock): boolean {
    return (['zh_Hans', 'en'] as const).every(languageCode => {
        const translation = clientPluginPageCopyTranslation(block, languageCode);
        return Boolean(translation.title.trim() && translation.body.trim());
    });
}

export function clientPluginCode(item: ContentItem): string | null {
    const value = item.settings?.pluginCode;
    return typeof value === 'string' ? value : null;
}

export function clientPluginPlacement(item: ContentItem): StorefrontClientPluginPlacement | null {
    const value = item.settings?.placement;
    return storefrontClientPluginPlacements.includes(value as StorefrontClientPluginPlacement)
        ? (value as StorefrontClientPluginPlacement)
        : null;
}

export function clientPluginCategoryRule(item: ContentItem): ClientPluginCategoryRule | null {
    const scope = item.settings?.categoryScope ?? 'ALL';
    const categoryIds = item.settings?.categoryIds ?? [];
    const includeChildren = item.settings?.includeChildren ?? true;
    if (
        (scope !== 'ALL' && scope !== 'SELECTED') ||
        !Array.isArray(categoryIds) ||
        categoryIds.some(id => typeof id !== 'string' || !id.trim()) ||
        typeof includeChildren !== 'boolean'
    ) {
        return null;
    }
    return {
        scope,
        categoryIds: Array.from(new Set(categoryIds.map(id => id.trim()))),
        includeChildren,
    };
}

export function createClientPluginDraft(block?: ContentBlock): ContentBlock {
    if (!block) {
        return {
            code: CLIENT_PLUGIN_BLOCK_CODE,
            internalName: '客户端插件配置',
            type: 'CLIENT_PLUGINS',
            layoutVariant: 'CUSTOM',
            enabled: true,
            position: 10_001,
            startsAt: null,
            endsAt: null,
            imageAsset: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: null,
            textColor: null,
            targetType: 'NONE',
            targetValue: null,
            settings: {
                version: 1,
                page: 'category',
                businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
            },
            translations: [blockTranslation('zh_Hans'), blockTranslation('en')],
            items: [],
        };
    }
    return {
        ...block,
        code: CLIENT_PLUGIN_BLOCK_CODE,
        internalName: '客户端插件配置',
        type: 'CLIENT_PLUGINS',
        layoutVariant: 'CUSTOM',
        enabled: true,
        settings: {
            ...(block.settings ?? {}),
            businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
        },
        translations: hasManagedBusinessServicesCopy(block)
            ? normalizedBlockTranslations(block.translations)
            : [blockTranslation('zh_Hans'), blockTranslation('en')],
        items: [...block.items]
            .sort((left, right) => left.position - right.position)
            .map((item, position) => ({
                ...item,
                enabled: true,
                position,
                targetType: 'NONE',
                settings: {
                    ...(item.settings ?? {}),
                    categoryScope: item.settings?.categoryScope ?? 'ALL',
                    categoryIds: Array.isArray(item.settings?.categoryIds) ? item.settings.categoryIds : [],
                    includeChildren:
                        typeof item.settings?.includeChildren === 'boolean'
                            ? item.settings.includeChildren
                            : true,
                },
            })),
    };
}

export function addClientPlugin(
    block: ContentBlock,
    definition: StorefrontClientPluginDefinition,
): ContentBlock {
    if (block.items.some(item => clientPluginCode(item) === definition.code)) return block;
    const position = block.items.length;
    return {
        ...block,
        items: [
            ...block.items,
            {
                enabled: true,
                position,
                imageAsset: null,
                imageAssetId: null,
                imageUrl: null,
                targetType: 'NONE',
                targetValue: null,
                settings: {
                    pluginCode: definition.code,
                    placement: definition.defaultPlacement,
                    categoryScope: 'ALL',
                    categoryIds: [],
                    includeChildren: true,
                },
                translations: [itemTranslation('zh_Hans', definition), itemTranslation('en', definition)],
            },
        ],
    };
}

export function targetClientPluginCategories(
    block: ContentBlock,
    pluginCode: string,
    rule: ClientPluginCategoryRule,
): ContentBlock {
    return {
        ...block,
        items: block.items.map(item =>
            clientPluginCode(item) === pluginCode
                ? {
                      ...item,
                      settings: {
                          ...(item.settings ?? {}),
                          pluginCode,
                          categoryScope: rule.scope,
                          categoryIds: Array.from(new Set(rule.categoryIds)),
                          includeChildren: rule.includeChildren,
                      },
                  }
                : item,
        ),
    };
}

export function removeClientPlugin(block: ContentBlock, pluginCode: string): ContentBlock {
    return {
        ...block,
        items: block.items
            .filter(item => clientPluginCode(item) !== pluginCode)
            .map((item, position) => ({ ...item, position })),
    };
}

export function placeClientPlugin(
    block: ContentBlock,
    pluginCode: string,
    placement: StorefrontClientPluginPlacement,
): ContentBlock {
    return {
        ...block,
        items: block.items.map(item =>
            clientPluginCode(item) === pluginCode
                ? { ...item, settings: { ...(item.settings ?? {}), pluginCode, placement } }
                : item,
        ),
    };
}

export function moveClientPlugin(block: ContentBlock, fromIndex: number, toIndex: number): ContentBlock {
    if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= block.items.length ||
        toIndex >= block.items.length ||
        fromIndex === toIndex
    ) {
        return block;
    }
    const items = [...block.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    return { ...block, items: items.map((item, position) => ({ ...item, position })) };
}

export function clientPluginDraftIsValid(block: ContentBlock): boolean {
    const codes = block.items.map(clientPluginCode);
    return (
        clientPluginPageCopyIsValid(block) &&
        codes.every(Boolean) &&
        new Set(codes).size === codes.length &&
        block.items.every(item => {
            const placement = clientPluginPlacement(item);
            const categoryRule = clientPluginCategoryRule(item);
            const categoryRuleIsValid =
                placement === 'BUSINESS_SERVICES_MAIN' ||
                (Boolean(categoryRule) &&
                    (categoryRule?.scope !== 'SELECTED' || Boolean(categoryRule.categoryIds.length)));
            return (
                Boolean(placement) &&
                categoryRuleIsValid &&
                item.translations.some(
                    translation => translation.languageCode === 'zh_Hans' && translation.label.trim(),
                )
            );
        })
    );
}

export function clientPluginBlockInput(block: ContentBlock) {
    return {
        code: CLIENT_PLUGIN_BLOCK_CODE,
        internalName: '客户端插件配置',
        type: 'CLIENT_PLUGINS' as const,
        layoutVariant: 'CUSTOM' as const,
        enabled: true,
        position: block.position,
        startsAt: null,
        endsAt: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE' as const,
        targetValue: null,
        settings: {
            ...(block.settings ?? {}),
            version: 1,
            page: 'category',
            businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
        },
        translations: block.translations.map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
            languageCode,
            title: title.trim(),
            subtitle: subtitle.trim(),
            body: body.trim(),
            ctaLabel: ctaLabel.trim(),
        })),
        items: block.items.map((item, position) => ({
            ...(item.id ? { id: item.id } : {}),
            enabled: true,
            position,
            imageAssetId: null,
            imageUrl: null,
            targetType: 'NONE' as const,
            targetValue: null,
            settings: item.settings,
            translations: item.translations.map(({ languageCode, label, description }) => ({
                languageCode,
                label: label.trim(),
                description: description.trim(),
            })),
        })),
    };
}

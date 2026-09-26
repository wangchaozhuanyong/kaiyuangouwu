import { parse } from 'graphql';
import { storefrontAssetUrl } from '../../../../storefront-content-plugin/src/content-image';
import type { StorefrontVisualPresetId } from '../../../../storefront-content-plugin/src/visual-presets';
import type { StorefrontContentBlock as ClientBlock } from '../../../../storefront/src/types';
import type { StorefrontContentBlock, StorefrontLanguageCode } from '../../graphql/storefront.graphql';
import { blockTranslation, itemTranslation } from './storefront-content-utils';
import { contentPublicationStatus } from './storefront-publication';

export interface DecorationDraft {
    block: ClientBlock | null;
    visible: boolean;
    route: string;
    language: 'zh' | 'en';
    presetId?: StorefrontVisualPresetId;
}

export function decorationDraft(
    block: StorefrontContentBlock,
    language: StorefrontLanguageCode,
): DecorationDraft {
    const imageUrl = block.imageAsset ? storefrontAssetUrl(block.imageAsset) : block.imageUrl;
    const route =
        block.type === 'SUPPORT'
            ? '/support'
            : block.type === 'AUTH_LOGIN'
              ? '/login'
              : block.type === 'AUTH_REGISTER'
                ? '/register'
                : block.type === 'ACCOUNT_HERO'
                  ? '/account'
                  : block.type === 'CLIENT_PLUGINS'
                    ? '/category'
                    : block.type === 'LEGAL'
                      ? '/legal?id=privacy'
                      : block.settings?.purpose === 'desktop-category-banner'
                        ? '/category'
                        : '/';
    return {
        language: language === 'zh_Hans' ? 'zh' : 'en',
        route,
        visible: contentPublicationStatus(block, Date.now(), language) === 'PUBLISHED',
        block: {
            id: block.id || `draft-${block.code}`,
            code: block.code,
            internalName: block.internalName,
            type: block.type,
            layoutVariant: block.layoutVariant,
            enabled: block.enabled,
            position: block.position,
            startsAt: block.startsAt,
            endsAt: block.endsAt,
            imageUrl: imageUrl || null,
            imageAsset:
                block.imageAsset?.width && block.imageAsset.height
                    ? { width: block.imageAsset.width, height: block.imageAsset.height }
                    : null,
            backgroundColor: block.backgroundColor,
            textColor: block.textColor,
            targetType: block.targetType,
            targetValue: block.targetValue,
            settings: block.settings,
            ...blockTranslation(block, language),
            items: block.items
                .filter(item => item.enabled)
                .map((item, index) => ({
                    id: item.id || `draft-item-${index}`,
                    enabled: item.enabled,
                    position: item.position,
                    imageUrl: item.imageAsset ? storefrontAssetUrl(item.imageAsset) : item.imageUrl,
                    targetType: item.targetType,
                    targetValue: item.targetValue,
                    settings: item.settings,
                    ...itemTranslation(item, language),
                }))
                .sort((a, b) => a.position - b.position),
        },
    };
}

export function applyDecorationDraft(blocks: ClientBlock[], draft: DecorationDraft): ClientBlock[] {
    const draftBlock = draft.block;
    if (!draftBlock) return blocks;
    const remaining = blocks.filter(block => block.id !== draftBlock.id && block.code !== draftBlock.code);
    return [...remaining, ...(draft.visible ? [draftBlock] : [])].sort((a, b) => a.position - b.position);
}

// Parse the full document: a query prefix alone must never admit a second mutation.
export function isReadOnlyPreviewQuery(query: unknown): query is string {
    if (typeof query !== 'string' || query.length > 100_000) return false;
    try {
        const operations = parse(query).definitions.filter(
            definition => definition.kind === 'OperationDefinition',
        );
        return operations.length === 1 && operations[0].operation === 'query';
    } catch {
        return false;
    }
}

// Bootstrap discovers the selected store's settlement currency before monetary queries.
export function previewQueryCurrencyCode(query: string, currency: unknown): string | undefined {
    if (typeof currency !== 'string' || !/^[A-Z]{3,5}$/.test(currency)) return undefined;
    const operation = parse(query).definitions.find(definition => definition.kind === 'OperationDefinition');
    return operation?.name?.value === 'StorefrontConfig' ? undefined : currency;
}

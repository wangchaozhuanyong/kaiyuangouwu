import { normalizeString } from '@/vdb/lib/utils.js';

interface CollectionQuickCreateInputOptions {
    name: string;
    parentId?: string;
    isVisible: boolean;
    assetIds?: string[] | null;
    featuredAssetId?: string | null;
}

export function buildCollectionQuickCreateInput({
    name,
    parentId,
    isVisible,
    assetIds,
    featuredAssetId,
}: CollectionQuickCreateInputOptions) {
    const trimmedName = name.trim();
    return {
        parentId,
        isPrivate: !isVisible,
        inheritFilters: false,
        filters: [],
        assetIds: assetIds ?? [],
        featuredAssetId,
        translations: [
            {
                languageCode: 'zh_Hans' as const,
                name: trimmedName,
                slug: normalizeString(trimmedName, '-'),
                description: '',
            },
        ],
    };
}

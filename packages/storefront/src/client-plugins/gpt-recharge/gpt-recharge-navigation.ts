import { type CollectionSummary, type StorefrontContentBlock } from '../../types';

const chatGptCategoryNames = new Set([
    'chatgpt',
    'chatgpt订阅',
    'chatgpt会员',
    'chatgpt套餐',
    'chatgpt专区',
    'chatgptsubscription',
    'chatgptsubscriptions',
    'chatgptplans',
    'gpt成品',
    // English equivalents of the shared finished-account category, including localized slugs.
    'gptfinishedproduct',
    'gptfinishedproducts',
    'chatgptfinishedproduct',
    'chatgptfinishedproducts',
    'chatgpt成品',
    'chatgpt成品号',
    'chatgpt成品账号',
    'chatgpt账号',
    'chatgptaccount',
    'chatgptaccounts',
]);

function normalizedCategoryName(value: string): string {
    return value
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[\s_\p{Pd}]+/gu, '');
}

function categoryRank(name: string, slug = ''): number {
    const normalizedName = normalizedCategoryName(name);
    const normalizedSlug = normalizedCategoryName(slug);
    if (normalizedSlug === 'chatgpt') return 3;
    if (normalizedName === 'chatgpt') return 2;
    return chatGptCategoryNames.has(normalizedName) || chatGptCategoryNames.has(normalizedSlug) ? 1 : 0;
}

/** Resolve only a category present in this channel; ambiguity must never open another category. */
export function resolveGptRechargeProductsCollection(
    collections: readonly CollectionSummary[],
    contentBlocks: readonly StorefrontContentBlock[] = [],
): CollectionSummary | null {
    const current = new Map<string, CollectionSummary>();
    const visit = (items: readonly CollectionSummary[]) => {
        for (const collection of items) {
            if (current.has(collection.id)) continue;
            current.set(collection.id, collection);
            visit(collection.children ?? []);
        }
    };
    visit(collections);

    const configuredTargets = contentBlocks
        .filter(block => block.enabled && (block.type === 'CORE_CATEGORIES' || block.type === 'NAVIGATION'))
        .flatMap(block => block.items)
        .filter(
            item =>
                item.enabled &&
                categoryRank(item.label) > 0 &&
                (item.targetType === 'CATEGORY' || item.targetType === 'COLLECTION'),
        );
    if (configuredTargets.length) {
        const ids = new Set(configuredTargets.map(item => item.targetValue?.trim() ?? ''));
        if (ids.size !== 1) return null;
        return current.get([...ids][0]) ?? null;
    }

    const ranked = [...current.values()].map(collection => ({
        collection,
        rank: categoryRank(collection.name, collection.slug),
    }));
    const bestRank = Math.max(0, ...ranked.map(candidate => candidate.rank));
    const best = ranked.filter(candidate => candidate.rank > 0 && candidate.rank === bestRank);
    return best.length === 1 ? best[0].collection : null;
}

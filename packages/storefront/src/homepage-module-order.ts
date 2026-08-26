import type { StorefrontContentBlock, StorefrontContentBlockType } from './types';

export const fixedHomepageModuleTypes = [
    'HERO',
    'NOTICE',
    'QUICK_LINKS',
    'CORE_CATEGORIES',
    'CATEGORY_AD',
    'FEATURED_COLLECTION',
    'COUPONS',
    'FLASH_SALE',
    'BEST_SELLERS',
    'RECOMMENDATIONS',
    'STORY',
    'TRUST_BAR',
] as const satisfies readonly StorefrontContentBlockType[];

export type FixedHomepageModuleType = (typeof fixedHomepageModuleTypes)[number];

export interface HomepageModuleEntry {
    key: string;
    type: FixedHomepageModuleType | 'CUSTOM';
    block?: StorefrontContentBlock;
    blocks: StorefrontContentBlock[];
    position: number;
    virtual: boolean;
}

const defaults: ReadonlyArray<{
    type: FixedHomepageModuleType;
    position: number;
    enabled: boolean;
}> = fixedHomepageModuleTypes.map((type, index) => ({
    type,
    position: (index + 1) * 10,
    enabled: !['CORE_CATEGORIES', 'CATEGORY_AD', 'FEATURED_COLLECTION', 'STORY'].includes(type),
}));

/**
 * Produces the exact homepage render order from persisted content. A configured
 * type with no returned block is disabled; an unconfigured type uses the
 * backwards-compatible default visibility.
 */
export function homepageModuleEntries(
    blocks: StorefrontContentBlock[],
    configuredTypes: StorefrontContentBlockType[],
): HomepageModuleEntry[] {
    const entries = defaults.flatMap<HomepageModuleEntry>(defaultModule => {
        const matching = blocks
            .filter(block => block.type === defaultModule.type)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
        if (matching.length) {
            return [
                {
                    key: `fixed:${defaultModule.type}`,
                    type: defaultModule.type,
                    block: matching[0],
                    blocks: matching,
                    position: matching[0].position,
                    virtual: false,
                } satisfies HomepageModuleEntry,
            ];
        }
        if (configuredTypes.includes(defaultModule.type) || !defaultModule.enabled) return [];
        return [
            {
                key: `fixed:${defaultModule.type}`,
                type: defaultModule.type,
                blocks: [],
                position: defaultModule.position,
                virtual: true,
            } satisfies HomepageModuleEntry,
        ];
    });
    const customEntries = blocks
        .filter(block => block.type === 'CUSTOM')
        .map(
            block =>
                ({
                    key: `custom:${block.id}`,
                    type: 'CUSTOM',
                    block,
                    blocks: [block],
                    position: block.position,
                    virtual: false,
                }) satisfies HomepageModuleEntry,
        );

    return [...entries, ...customEntries].sort(
        (a, b) => a.position - b.position || defaultIndex(a.type) - defaultIndex(b.type),
    );
}

function defaultIndex(type: HomepageModuleEntry['type']): number {
    const index = fixedHomepageModuleTypes.indexOf(type as FixedHomepageModuleType);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

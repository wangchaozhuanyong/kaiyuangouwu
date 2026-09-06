import type { StorefrontContentBlock, StorefrontContentBlockType } from './types';

import { isSharingContent } from '../../storefront-content-plugin/src/content-purpose';
import {
    homepageModuleCatalog,
    repeatableHomepageModuleTypes,
} from '../../storefront-content-plugin/src/homepage-manifest';

export const fixedHomepageModuleTypes = homepageModuleCatalog.map(module => module.type);

export type FixedHomepageModuleType = (typeof fixedHomepageModuleTypes)[number];

export interface HomepageModuleEntry {
    key: string;
    type: FixedHomepageModuleType | 'CUSTOM';
    block?: StorefrontContentBlock;
    blocks: StorefrontContentBlock[];
    position: number;
    virtual: boolean;
}

const desktopIntroModuleTypes = [
    'HERO',
    'TRUST_BAR',
    'QUICK_LINKS',
] as const satisfies readonly FixedHomepageModuleType[];

/** Render only persisted blocks returned by the publication API. */
export function homepageModuleEntries(
    blocks: StorefrontContentBlock[],
    _configuredTypes: StorefrontContentBlockType[],
): HomepageModuleEntry[] {
    const homepageBlocks = blocks.filter(block => !isSharingContent(block));
    const entries = fixedHomepageModuleTypes.flatMap<HomepageModuleEntry>(type => {
        if (repeatableHomepageModuleTypes.some(repeatable => repeatable === type)) return [];
        const matching = homepageBlocks
            .filter(block => block.type === type)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
        if (matching.length) {
            return [
                {
                    key: `fixed:${type}`,
                    type,
                    block: matching[0],
                    blocks: matching,
                    position: matching[0].position,
                    virtual: false,
                } satisfies HomepageModuleEntry,
            ];
        }
        return [];
    });
    const customEntries = homepageBlocks
        .filter(block => repeatableHomepageModuleTypes.some(type => type === block.type))
        .map(
            block =>
                ({
                    key: `content:${block.id}`,
                    type: block.type as HomepageModuleEntry['type'],
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

/**
 * The desktop hero/sidebar composition is only safe when its three modules are
 * adjacent and keep the intended visual order. Any merchant reordering falls
 * back to full-width modules so the persisted homepage order remains exact.
 */
export function desktopIntroModuleOrder(entries: HomepageModuleEntry[]): number | null {
    const startIndex = entries.findIndex(entry => entry.type === desktopIntroModuleTypes[0]);
    if (startIndex < 0) return null;

    const isCanonicalGroup = desktopIntroModuleTypes.every(
        (type, offset) => entries[startIndex + offset]?.type === type,
    );
    return isCanonicalGroup ? startIndex : null;
}

function defaultIndex(type: HomepageModuleEntry['type']): number {
    const index = fixedHomepageModuleTypes.indexOf(type as FixedHomepageModuleType);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

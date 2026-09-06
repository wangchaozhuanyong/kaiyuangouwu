import { isSharingContent } from '../../../../storefront-content-plugin/src/content-purpose';
import type { StorefrontContentBlock } from '../../graphql/storefront.graphql';
import { homepageModuleDescriptors } from './storefront-content-utils';

export interface StorefrontHomepageRow {
    key: string;
    blocks: StorefrontContentBlock[];
}

const homepageTypes = new Set(homepageModuleDescriptors.map(item => item.type));

export function isHomepageBlock(block: StorefrontContentBlock) {
    return !isSharingContent(block) && (homepageTypes.has(block.type) || block.type === 'CUSTOM');
}

export function storefrontHomepageRows(blocks: StorefrontContentBlock[]): StorefrontHomepageRow[] {
    const rows: StorefrontHomepageRow[] = [];
    const heroes = blocks.filter(block => isHomepageBlock(block) && block.type === 'HERO');
    for (const block of blocks.filter(isHomepageBlock)) {
        if (block.type === 'HERO') {
            if (block !== heroes[0]) continue;
            rows.push({ key: 'carousel', blocks: heroes });
        } else {
            rows.push({ key: block.id ?? block.code, blocks: [block] });
        }
    }
    return rows;
}

/** Keep non-homepage content in its slots; the API requires every store block exactly once. */
export function homepageOrderIds(blocks: StorefrontContentBlock[], rows: StorefrontHomepageRow[]) {
    const homepageIds = rows.flatMap(row => row.blocks.map(block => block.id!));
    let index = 0;
    return blocks.map(block => (isHomepageBlock(block) ? homepageIds[index++] : block.id!));
}

export function moveHomepageRow(blocks: StorefrontContentBlock[], key: string, direction: -1 | 1) {
    const rows = storefrontHomepageRows(blocks);
    const index = rows.findIndex(row => row.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rows.length) return null;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    return homepageOrderIds(blocks, rows);
}

export function dropHomepageRow(
    blocks: StorefrontContentBlock[],
    sourceKey: string,
    targetKey: string,
    placement: 'before' | 'after',
) {
    const rows = storefrontHomepageRows(blocks);
    const source = rows.find(row => row.key === sourceKey);
    if (!source || sourceKey === targetKey || !rows.some(row => row.key === targetKey)) return null;
    const next = rows.filter(row => row !== source);
    const targetIndex = next.findIndex(row => row.key === targetKey);
    next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
    if (next.every((row, index) => row === rows[index])) return null;
    return homepageOrderIds(blocks, next);
}

export function moveCarouselSlide(blocks: StorefrontContentBlock[], id: string, direction: -1 | 1) {
    const rows = storefrontHomepageRows(blocks);
    const carousel = rows.find(row => row.key === 'carousel');
    if (!carousel) return null;
    const index = carousel.blocks.findIndex(block => block.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= carousel.blocks.length) return null;
    [carousel.blocks[index], carousel.blocks[target]] = [carousel.blocks[target], carousel.blocks[index]];
    return homepageOrderIds(blocks, rows);
}

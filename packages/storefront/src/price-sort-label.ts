import type { SortMode } from './storefront-router';

/** The same price action is announced consistently in catalog and search. */
export function priceSortActionLabel(sort: SortMode, isZh: boolean): string {
    const low = isZh ? '从低到高' : 'low to high';
    const high = isZh ? '从高到低' : 'high to low';
    if (sort !== 'price-asc' && sort !== 'price-desc')
        return isZh ? `价格排序，点击按${low}排列` : `Sort by price. Click for ${low}`;
    const current = sort === 'price-asc' ? low : high;
    const next = sort === 'price-asc' ? high : low;
    return isZh ? `价格${current}，点击改为${next}` : `Price: ${current}. Click for ${next}`;
}

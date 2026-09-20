import { type RequestContext } from '@vendure/core';

import { type NormalizedCatalogRow } from './types';

export type CatalogFulfillmentType = 'digital' | 'physical';

export interface CatalogCollectionHierarchyRecord {
    name?: string | null;
    translations?: Array<{ languageCode?: string | null; name?: string | null }>;
    parent?: CatalogCollectionHierarchyRecord & { isRoot?: boolean | null };
}

export function parseCatalogFulfillmentType(value: unknown, rowNumber: number): CatalogFulfillmentType {
    const text = (typeof value === 'string' ? value : '').normalize('NFKC').trim().toLowerCase();
    if (['digital', '虚拟', '虚拟货品', '虚拟商品'].includes(text)) return 'digital';
    if (['physical', '实物', '实物货品', '实物商品'].includes(text)) return 'physical';
    throw new Error(`第 ${rowNumber} 行：商品类型必须填写“虚拟货品”或“实物”`);
}

export function catalogCategoryPath(
    row: Pick<NormalizedCatalogRow, 'category' | 'secondaryCategory'>,
): string {
    return [row.category, row.secondaryCategory].filter(Boolean).join(' > ');
}

export function splitCatalogCategoryPath(path: string): { category: string; secondaryCategory: string } {
    const [category = '', secondaryCategory = ''] = path.split(' > ');
    return { category, secondaryCategory };
}

export function catalogCollectionPath(
    collection: CatalogCollectionHierarchyRecord,
    languageCode?: string,
): string {
    const name = localizedCollectionName(collection, languageCode);
    if (!name) return '';
    const parent = collection.parent;
    if (!parent || parent.isRoot) return name;
    const parentName = localizedCollectionName(parent, languageCode);
    return parentName ? `${parentName} > ${name}` : name;
}

export function preferredCatalogCategoryPath(
    importCategory: string | null | undefined,
    collectionPaths: string[],
): string {
    const normalizedMarker = normalizeCategoryPath(importCategory ?? '');
    const candidates = [...new Set(collectionPaths.map(path => path.trim()).filter(Boolean))];
    const markerHasParent = Boolean(splitCatalogCategoryPath(importCategory ?? '').secondaryCategory);
    if (normalizedMarker && !markerHasParent) {
        const matchingLeafPaths = candidates.filter(path => {
            const { secondaryCategory } = splitCatalogCategoryPath(path);
            return secondaryCategory && normalizeCategoryPath(secondaryCategory) === normalizedMarker;
        });
        if (matchingLeafPaths.length === 1) return matchingLeafPaths[0];
    }
    const matchingCollectionPath = candidates.find(path => normalizeCategoryPath(path) === normalizedMarker);
    if (matchingCollectionPath) return matchingCollectionPath;

    const hierarchical = candidates
        .filter(path => splitCatalogCategoryPath(path).secondaryCategory)
        .sort((left, right) => left.localeCompare(right, 'zh-Hans'));
    if (hierarchical.length > 0) return hierarchical[0];
    if (importCategory?.trim()) return importCategory.trim();
    return candidates.sort((left, right) => left.localeCompare(right, 'zh-Hans'))[0] ?? '';
}

export function validateCatalogCategories(
    category: string,
    secondaryCategory: string,
    rowNumber: number,
): void {
    if (secondaryCategory && !category) throw new Error(`第 ${rowNumber} 行：填写二级分类时必须填写一级分类`);
    if ([category, secondaryCategory].some(value => value.includes('>'))) {
        throw new Error(`第 ${rowNumber} 行：请将一级分类和二级分类分列填写，分类名称不能包含 >`);
    }
}

export function catalogImportTypeError(ctx: RequestContext, row: NormalizedCatalogRow): string | null {
    if (!row.fulfillmentType) return null;
    try {
        parseCatalogFulfillmentType(row.fulfillmentType, row.rowNumber);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    const mode = (ctx.channel?.customFields as unknown as Record<string, unknown>)?.commerceMode;
    if (mode === 'DIGITAL_ONLY' && row.fulfillmentType === 'physical')
        return '当前门店仅经营虚拟货品，不能导入实物；请先在门店设置中调整经营模式';
    if (mode === 'PHYSICAL_ONLY' && row.fulfillmentType === 'digital')
        return '当前门店仅经营实物，不能导入虚拟货品；请先在门店设置中调整经营模式';
    return null;
}

function localizedCollectionName(
    collection: CatalogCollectionHierarchyRecord,
    languageCode?: string,
): string {
    const translations = collection.translations ?? [];
    return (
        translations.find(translation => translation.languageCode === languageCode)?.name ??
        translations[0]?.name ??
        collection.name ??
        ''
    ).trim();
}

function normalizeCategoryPath(path: string): string {
    return path
        .normalize('NFKC')
        .split('>')
        .map(part => part.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans'))
        .filter(Boolean)
        .join(' > ');
}

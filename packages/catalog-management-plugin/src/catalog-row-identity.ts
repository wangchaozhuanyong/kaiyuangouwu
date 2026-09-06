import type { NormalizedCatalogRow } from './types';

import { catalogCategoryPath } from './catalog-import-classification';

export function assignCatalogSourceRecordKeys(rows: NormalizedCatalogRow[]): NormalizedCatalogRow[] {
    const occurrences = new Map<string, number>();
    return rows.map(row => {
        const base = catalogSourceRecordBase(row);
        if (row.sku || row.barcode) return { ...row, sourceRecordKey: base };
        const occurrence = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, occurrence);
        return { ...row, sourceRecordKey: `${base}\u001fordinal\u001f${occurrence}` };
    });
}

export function catalogSourceRecordBase(
    row: Pick<
        NormalizedCatalogRow,
        | 'name'
        | 'category'
        | 'secondaryCategory'
        | 'specification'
        | 'primaryUnit'
        | 'sku'
        | 'barcode'
        | 'stockLocationCode'
        | 'lotCode'
    >,
): string {
    const base = row.sku
        ? `sku\u001f${normalizeCatalogIdentity(row.sku)}`
        : row.barcode
          ? `barcode\u001f${normalizeCatalogIdentity(row.barcode)}`
          : ['legacy', row.name, catalogCategoryPath(row), row.specification, row.primaryUnit]
                .map(normalizeCatalogIdentity)
                .join('\u001f');
    const inventoryScope = [row.stockLocationCode, row.lotCode]
        .map(normalizeCatalogIdentity)
        .filter(Boolean)
        .join('\u001f');
    return inventoryScope ? `${base}\u001finventory\u001f${inventoryScope}` : base;
}

export function normalizeCatalogIdentity(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans');
}

export function resolveImportExecutionVariantId<T>(
    resolution: string | null,
    targetVariantId: T | null,
    cachedVariantId?: T,
    forceCreateNew = false,
): T | null {
    return resolution === 'CREATE_NEW' || forceCreateNew
        ? null
        : (targetVariantId ?? cachedVariantId ?? null);
}

export function catalogCreateNewSourceRecordKey(sourceRecordKey: string, rowNumber: number): string {
    const suffix = `\u001fcreate-new\u001f${rowNumber}`;
    return sourceRecordKey.endsWith(suffix) ? sourceRecordKey : `${sourceRecordKey}${suffix}`;
}

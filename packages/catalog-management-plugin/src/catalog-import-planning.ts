import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { ProductVariant, RequestContext } from '@vendure/core';

import {
    catalogExactRowFingerprint,
    catalogProductKey,
    catalogSourceKey,
    normalizeIdentity,
} from './catalog-file-parser.service';
import {
    effectiveVariantEnabled,
    isBlankValue,
    optionalUpdate,
    sameValue,
    shouldClear,
    stringValue,
} from './catalog-import-helpers';
import {
    CatalogImportAction,
    CatalogImportContextInput,
    CatalogImportState,
    NormalizedCatalogRow,
} from './types';

export const reusableCatalogImportStates: CatalogImportState[] = [
    'RECEIVING',
    'PREVIEW_READY',
    'QUEUED',
    'RUNNING',
    'FAILED',
    'COMPLETED_WITH_ERRORS',
];

export interface PlannedRow {
    action: CatalogImportAction;
    targetProductId: ID | null;
    targetVariantId: ID | null;
    expectedProductUpdatedAt: Date | null;
    expectedVariantUpdatedAt: Date | null;
    beforeSnapshot: Record<string, unknown> | null;
    plannedChanges: Record<string, unknown> | null;
    message: string | null;
}

export function emptyPlan(action: CatalogImportAction): PlannedRow {
    return {
        action,
        targetProductId: null,
        targetVariantId: null,
        expectedProductUpdatedAt: null,
        expectedVariantUpdatedAt: null,
        beforeSnapshot: null,
        plannedChanges: null,
        message: null,
    };
}

export function catalogImportOptionGroupCode(productId: ID): string {
    return `import-sku-${String(productId)}`.slice(0, 64);
}

export function catalogImportOptionCode(sourceKey: string): string {
    return `import-${sourceKey
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`.slice(0, 64);
}

export function conflictPlan(message: string): PlannedRow {
    return { ...emptyPlan('CONFLICT'), message };
}

export function warningPlan(plan: PlannedRow, message: string): PlannedRow {
    return {
        ...plan,
        action: 'WARNING',
        plannedChanges: { ...(plan.plannedChanges ?? {}), safeAction: plan.action },
        message,
    };
}

export function withRiskConfirmation(
    plannedChanges: Record<string, unknown> | null,
    ctx: RequestContext,
): Record<string, unknown> {
    return {
        ...(plannedChanges ?? {}),
        riskConfirmation: {
            actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            confirmedAt: new Date().toISOString(),
        },
    };
}

export function validationWarning(row: NormalizedCatalogRow): string | null {
    if (row.stockOnHand != null && row.stockOnHand < 0) return '库存为负数，默认不执行';
    if (row.purchaseCost != null && row.sellingPrice != null && row.sellingPrice < row.purchaseCost) {
        return '销售价低于进货价，默认不执行';
    }
    if (row.minimumStock != null && row.maximumStock != null && row.maximumStock < row.minimumStock) {
        return '库存上限小于库存下限，默认不执行';
    }
    if (row.reportedMargin != null && row.sellingPrice && row.purchaseCost != null) {
        const calculated = (row.sellingPrice - row.purchaseCost) / row.sellingPrice;
        if (Math.abs(calculated - row.reportedMargin) > 0.0002) return '文件毛利率与成本、售价计算结果不一致';
    }
    return null;
}

export function importScopeError(
    row: NormalizedCatalogRow,
    ctx: RequestContext,
    input: CatalogImportContextInput,
    stockLocation: { id: ID; name: string },
): string | null {
    if (
        row.channelCode &&
        ![String(ctx.channelId), normalizeIdentity(ctx.channel.code)].includes(
            normalizeIdentity(row.channelCode),
        )
    ) {
        return '文件门店与当前选择的门店不一致，默认不执行';
    }
    if (
        row.stockLocationCode &&
        ![String(stockLocation.id), normalizeIdentity(stockLocation.name)].includes(
            normalizeIdentity(row.stockLocationCode),
        )
    ) {
        return '文件仓库与当前选择的仓库不一致，默认不执行';
    }
    if (row.currencyCode && row.currencyCode !== String(input.currencyCode)) {
        return '文件币种与当前选择的币种不一致，默认不执行';
    }
    return null;
}

export function effectiveStockLocation(
    reference: string,
    fallbackId: ID,
    locations: Array<{ id: string; name: string }>,
): { id: string; name: string } | undefined {
    if (!reference.trim()) {
        return locations.find(location => String(location.id) === String(fallbackId));
    }
    const normalized = normalizeIdentity(reference);
    return locations.find(
        location =>
            normalizeIdentity(String(location.id)) === normalized ||
            normalizeIdentity(location.name) === normalized,
    );
}

export function variantExecutionKey(row: NormalizedCatalogRow): string {
    if (row.sku) return `sku\u001f${normalizeIdentity(row.sku)}`;
    if (row.barcode) return `barcode\u001f${normalizeIdentity(row.barcode)}`;
    if (row.sourceRecordKey) return `record\u001f${row.sourceRecordKey}`;
    return [row.name, row.category, row.specification, row.primaryUnit].map(normalizeIdentity).join('\u001f');
}

export function groupRows(rows: NormalizedCatalogRow[]): Map<string, NormalizedCatalogRow[]> {
    const groups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows)
        groups.set(catalogSourceKey(row), [...(groups.get(catalogSourceKey(row)) ?? []), row]);
    return groups;
}

export function groupProductRows(rows: NormalizedCatalogRow[]): Map<string, NormalizedCatalogRow[]> {
    const groups = new Map<string, NormalizedCatalogRow[]>();
    for (const row of rows) {
        const key = catalogProductKey(row);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return groups;
}

export function firstExactRowNumbers(rows: NormalizedCatalogRow[]): Map<string, number> {
    const firstRows = new Map<string, number>();
    for (const row of rows) {
        const fingerprint = catalogExactRowFingerprint(row);
        if (!firstRows.has(fingerprint)) firstRows.set(fingerprint, row.rowNumber);
    }
    return firstRows;
}

export function productFieldFingerprint(row: NormalizedCatalogRow): string {
    return JSON.stringify({
        name: row.name,
        category: row.category,
        enabled: row.enabled,
        description: row.description,
        tags: row.tags,
    });
}

export function productDescriptionForCreate(row: NormalizedCatalogRow): string {
    return row.description.trim() || row.name.trim();
}

export function isCatalogImportResolutionState(state: CatalogImportState): boolean {
    return ['PREVIEW_READY', 'FAILED', 'COMPLETED_WITH_ERRORS'].includes(state);
}

export function variantMatches(variant: ProductVariant, row: NormalizedCatalogRow): boolean {
    const fields = (variant.customFields ?? {}) as Record<string, unknown>;
    const specification = normalizeIdentity(stringValue(fields.specification));
    const unit = normalizeIdentity(stringValue(fields.saleUnit));
    if (!row.specification && !row.primaryUnit) return specification === '' && unit === '';
    return (
        specification === normalizeIdentity(row.specification) && unit === normalizeIdentity(row.primaryUnit)
    );
}

export function createChanges(
    row: NormalizedCatalogRow,
    currencyCode: CurrencyCode,
): Record<string, unknown> {
    return {
        name: row.name,
        category: row.category,
        specification: row.specification,
        saleUnit: row.primaryUnit,
        purchaseUnit: row.purchaseUnit || row.primaryUnit,
        packageQuantity: row.packageQuantity ?? 1,
        sku: row.sku || '系统自动生成',
        sellingPrice: money(row.sellingPrice),
        purchaseCostMicrounits: microunits(row.purchaseCost),
        stockOnHand: row.stockOnHand,
        sourceCreatedAt: row.sourceCreatedAt,
        productEnabled: row.enabled ?? true,
        variantEnabled: effectiveVariantEnabled(row) ?? true,
        supplier: row.supplier || null,
        currencyCode,
    };
}

export function changed(
    target: Record<string, unknown>,
    key: string,
    next: unknown,
    previous: unknown,
): void {
    if (next === null || next === undefined || next === '') return;
    if (!samePlannedValue(key, next, previous)) target[key] = { from: previous ?? null, to: next };
}

export function changedOptional(
    target: Record<string, unknown>,
    key: string,
    next: unknown,
    previous: unknown,
    clear: boolean,
    clearedValue: unknown = null,
): void {
    if (!isBlankValue(next)) {
        if (!samePlannedValue(key, next, previous)) target[key] = { from: previous ?? null, to: next };
        return;
    }
    if (clear && !isBlankValue(previous)) {
        target[key] = { from: previous, to: clearedValue };
    }
}

function samePlannedValue(key: string, next: unknown, previous: unknown): boolean {
    // Parsing normalizes display text; keep the stored spelling when only that normalization differs.
    if (
        ['productName', 'productDescription', 'category'].includes(key) &&
        typeof next === 'string' &&
        typeof previous === 'string'
    ) {
        return next.normalize('NFKC') === previous.normalize('NFKC');
    }
    return sameValue(next, previous);
}

export function money(value: number | null): number {
    return Math.round((value ?? 0) * 100);
}

export function microunits(value: number | null): number {
    return Math.round((value ?? 0) * 1_000);
}

export function variantDisplayName(row: NormalizedCatalogRow): string {
    const detail = [row.specification, row.primaryUnit].filter(Boolean).join(' / ');
    return detail ? `${row.name} · ${detail}` : row.name;
}

export function variantCustomFields(row: NormalizedCatalogRow): Record<string, unknown> {
    return {
        barcode: row.barcode || null,
        specification: row.specification || null,
        saleUnit: row.primaryUnit || null,
        purchaseUnit: row.purchaseUnit || row.primaryUnit || null,
        packageQuantity: row.packageQuantity ?? 1,
        shelfLifeDays: row.shelfLifeDays,
    };
}

export function variantCustomFieldUpdates(
    row: NormalizedCatalogRow,
    clearBlankFields: boolean,
): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    optionalUpdate(updates, 'barcode', row.barcode, shouldClear(row, 'barcode', clearBlankFields));
    optionalUpdate(
        updates,
        'specification',
        row.specification,
        shouldClear(row, 'specification', clearBlankFields),
    );
    const clearUnit = shouldClear(row, 'primaryUnit', clearBlankFields);
    optionalUpdate(updates, 'saleUnit', row.primaryUnit, clearUnit);
    optionalUpdate(
        updates,
        'purchaseUnit',
        row.purchaseUnit,
        shouldClear(row, 'purchaseUnit', clearBlankFields),
    );
    if (row.packageQuantity != null) updates.packageQuantity = row.packageQuantity;
    optionalUpdate(
        updates,
        'shelfLifeDays',
        row.shelfLifeDays,
        shouldClear(row, 'shelfLifeDays', clearBlankFields),
    );
    return updates;
}

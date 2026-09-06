import { type RequestContext } from '@vendure/core';

import { type NormalizedCatalogRow } from './types';

export function parseCatalogImportStore(value: unknown, rowNumber: number): string {
    const store = (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
        .normalize('NFKC')
        .trim();
    if (!store || store.length > 255) {
        throw new Error(`第 ${rowNumber} 行：导入商店必填，请填写目标商店标识（可从当前商店下载模板）`);
    }
    return store;
}

export function catalogImportStoreError(
    row: Pick<NormalizedCatalogRow, 'channelCode' | 'rowNumber'>,
    ctx: RequestContext,
): string | null {
    let store: string;
    try {
        store = parseCatalogImportStore(row.channelCode, row.rowNumber);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    // Store codes are exact identifiers, not display names or fuzzy matches.
    if (![String(ctx.channelId), ctx.channel.code].includes(store)) {
        return `第 ${row.rowNumber} 行：导入商店“${store}”与当前商店“${ctx.channel.code}”不一致，请切换商店或修正文件`;
    }
    return null;
}

import type { NormalizedCatalogRow } from '../types';

export const MAX_CATALOG_APPEND_ROWS = 500;
export const MAX_CATALOG_APPEND_REQUEST_BYTES = 512 * 1024;
const textEncoder = new TextEncoder();

export interface CatalogAppendRequestDocument {
    operationName: string;
    query: string;
}

const defaultRequestDocument: CatalogAppendRequestDocument = {
    operationName: 'AppendCatalogImportRows',
    query: 'mutation AppendCatalogImportRows($input: AppendCatalogImportRowsInput!){appendCatalogImportRows(input:$input){id}}',
};

export function createCatalogImportBatches(
    jobId: string,
    rows: NormalizedCatalogRow[],
    requestDocument: CatalogAppendRequestDocument = defaultRequestDocument,
): NormalizedCatalogRow[][] {
    const batches: NormalizedCatalogRow[][] = [];
    let current: NormalizedCatalogRow[] = [];
    const emptyRequestBytes = catalogAppendRequestBytes(jobId, [], requestDocument);
    let currentRequestBytes = emptyRequestBytes;

    for (const row of rows) {
        const rowBytes = textEncoder.encode(JSON.stringify(row)).byteLength;
        const separatorBytes = current.length > 0 ? 1 : 0;
        const candidateRequestBytes = currentRequestBytes + separatorBytes + rowBytes;
        if (
            current.length + 1 > MAX_CATALOG_APPEND_ROWS ||
            candidateRequestBytes > MAX_CATALOG_APPEND_REQUEST_BYTES
        ) {
            if (current.length === 0) {
                throw new Error(`第 ${row.rowNumber} 行内容过大，无法在安全请求上限内上传`);
            }
            batches.push(current);
            current = [row];
            currentRequestBytes = emptyRequestBytes + rowBytes;
            if (currentRequestBytes > MAX_CATALOG_APPEND_REQUEST_BYTES) {
                throw new Error(`第 ${row.rowNumber} 行内容过大，无法在安全请求上限内上传`);
            }
        } else {
            current.push(row);
            currentRequestBytes = candidateRequestBytes;
        }
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

export function catalogAppendRequestBytes(
    jobId: string,
    rows: NormalizedCatalogRow[],
    requestDocument: CatalogAppendRequestDocument = defaultRequestDocument,
): number {
    const envelope = JSON.stringify({
        operationName: requestDocument.operationName,
        query: requestDocument.query,
        variables: { input: { jobId, rows } },
    });
    return textEncoder.encode(envelope).byteLength;
}

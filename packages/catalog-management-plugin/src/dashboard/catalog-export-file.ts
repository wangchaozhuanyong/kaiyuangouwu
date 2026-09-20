/// <reference types="vite/client" />

import type { CatalogExportRowRecord } from './catalog-management.graphql';

import CatalogExportFileWorker from './catalog-export-file.worker?worker';
import { buildCatalogExport } from './catalog-export-workbook';

export type CatalogExportFormat = 'xlsx' | 'csv';

export interface CatalogExportWorkerRequest {
    rows: CatalogExportRowRecord[];
    format: CatalogExportFormat;
    stockLocationId?: string;
}

export type CatalogExportWorkerResponse =
    | { ok: true; buffer: ArrayBuffer; mimeType: string; extension: CatalogExportFormat }
    | { ok: false; message: string };

export async function exportCatalogRowsLocally(
    rows: CatalogExportRowRecord[],
    format: CatalogExportFormat,
    stockLocationId?: string,
): Promise<{ blob: Blob; extension: CatalogExportFormat }> {
    const buildOnMainThread = () => {
        const result = buildCatalogExport(rows, format, stockLocationId);
        return { blob: new Blob([result.buffer], { type: result.mimeType }), extension: result.extension };
    };
    if (typeof Worker === 'undefined') {
        return buildOnMainThread();
    }
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new CatalogExportFileWorker({ name: 'catalog-export-builder' });
        } catch {
            resolve(buildOnMainThread());
            return;
        }
        let settled = false;
        const timeout = window.setTimeout(() => fallbackToMainThread(), 30_000);
        const close = () => {
            window.clearTimeout(timeout);
            worker.terminate();
        };
        const fallbackToMainThread = () => {
            if (settled) return;
            settled = true;
            close();
            try {
                resolve(buildOnMainThread());
            } catch (error) {
                reject(error instanceof Error ? error : new Error('浏览器本地生成报表失败'));
            }
        };
        worker.onmessage = (event: MessageEvent<CatalogExportWorkerResponse>) => {
            if (settled) return;
            settled = true;
            close();
            if ('message' in event.data) {
                reject(new Error(event.data.message));
                return;
            }
            resolve({
                blob: new Blob([event.data.buffer], { type: event.data.mimeType }),
                extension: event.data.extension,
            });
        };
        worker.onerror = fallbackToMainThread;
        worker.onmessageerror = fallbackToMainThread;
        try {
            worker.postMessage({ rows, format, stockLocationId } satisfies CatalogExportWorkerRequest);
        } catch {
            fallbackToMainThread();
        }
    });
}

export function downloadCatalogBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

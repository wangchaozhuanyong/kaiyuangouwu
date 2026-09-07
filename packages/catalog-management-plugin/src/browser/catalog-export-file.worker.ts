/// <reference lib="webworker" />

import type { CatalogExportWorkerRequest, CatalogExportWorkerResponse } from './catalog-export-file';

import { buildCatalogExport } from './catalog-export-workbook';

self.onmessage = (event: MessageEvent<CatalogExportWorkerRequest>) => {
    let response: CatalogExportWorkerResponse;
    try {
        const result = buildCatalogExport(event.data.rows, event.data.format, event.data.stockLocationId);
        response = { ok: true, ...result };
        self.postMessage(response, { transfer: [result.buffer] });
        return;
    } catch (error) {
        response = {
            ok: false,
            message: error instanceof Error ? error.message : '浏览器本地生成报表失败',
        };
    }
    self.postMessage(response);
};

export {};

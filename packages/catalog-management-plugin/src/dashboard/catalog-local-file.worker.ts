/// <reference lib="webworker" />

import type { CatalogWorkerRequest, CatalogWorkerResponse } from './catalog-local-file';

import { parseCatalogArrayBuffer } from './catalog-local-file';

self.onmessage = async (event: MessageEvent<CatalogWorkerRequest>) => {
    let response: CatalogWorkerResponse;
    try {
        response = {
            ok: true,
            result: await parseCatalogArrayBuffer(
                event.data.buffer,
                event.data.filename,
                event.data.mimetype,
                event.data.fieldMapping,
            ),
        };
    } catch (error) {
        response = {
            ok: false,
            message: error instanceof Error ? error.message : '浏览器本地解析失败',
        };
    }
    self.postMessage(response);
};

export {};

/// <reference lib="webworker" />

import {
    parseCatalogArrayBuffer,
    type CatalogWorkerRequest,
    type CatalogWorkerResponse,
} from '@vendure/catalog-management-plugin/browser';

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

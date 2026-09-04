import {
    MAX_LOCAL_CATALOG_BYTES,
    parseCatalogArrayBuffer,
    type CatalogWorkerResponse,
    type LocalCatalogFile,
} from '@vendure/catalog-management-plugin/browser';

import CatalogImportWorker from './catalog-import.worker?worker';

export async function parseCatalogFile(
    file: File,
    fieldMapping?: Record<string, string>,
): Promise<LocalCatalogFile> {
    assertCatalogFile(file);
    const buffer = await file.arrayBuffer();
    if (typeof Worker === 'undefined') {
        return parseCatalogArrayBuffer(buffer, file.name, file.type, fieldMapping);
    }
    return new Promise((resolve, reject) => {
        const worker = new CatalogImportWorker({ name: 'next-admin-catalog-import' });
        const close = () => worker.terminate();
        worker.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
            close();
            if ('result' in event.data) resolve(event.data.result);
            else reject(new Error(event.data.message));
        };
        worker.onerror = event => {
            close();
            reject(new Error(event.message || '浏览器本地解析失败'));
        };
        worker.postMessage({ filename: file.name, mimetype: file.type, buffer, fieldMapping }, [buffer]);
    });
}

function assertCatalogFile(file: File) {
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(file.name)) {
        throw new Error('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
    if (file.size < 1) throw new Error('导入文件为空');
    if (file.size > MAX_LOCAL_CATALOG_BYTES) throw new Error('导入文件不能超过 20MB');
}

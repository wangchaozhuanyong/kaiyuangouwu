import {
    type CatalogWorkerRequest,
    type CatalogWorkerResponse,
    type LocalCatalogFile,
    MAX_LOCAL_CATALOG_BYTES,
    parseCatalogArrayBuffer,
} from './catalog-local-file';
import CatalogLocalFileWorker from './catalog-local-file.worker?worker';

export async function parseCatalogFileLocally(
    file: File,
    fieldMapping?: Record<string, string>,
): Promise<LocalCatalogFile> {
    assertLocalFile(file.name, file.size);
    const buffer = await file.arrayBuffer();
    if (typeof Worker === 'undefined') {
        return parseCatalogArrayBuffer(buffer, file.name, file.type, fieldMapping);
    }
    return new Promise((resolve, reject) => {
        const worker = new CatalogLocalFileWorker({ name: 'catalog-local-file-parser' });
        const close = () => worker.terminate();
        worker.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
            close();
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.message));
        };
        worker.onerror = event => {
            close();
            reject(new Error(event.message || '浏览器本地解析失败'));
        };
        worker.postMessage(
            { filename: file.name, mimetype: file.type, buffer, fieldMapping } satisfies CatalogWorkerRequest,
            [buffer],
        );
    });
}

function assertLocalFile(filename: string, byteSize: number): void {
    if (!/\.(numbers|xlsx|xls|csv)$/i.test(filename)) {
        throw new Error('仅支持 .numbers、.xlsx、.xls 或 .csv 文件');
    }
    if (byteSize < 1) throw new Error('导入文件为空');
    if (byteSize > MAX_LOCAL_CATALOG_BYTES) throw new Error('导入文件不能超过 20MB');
}

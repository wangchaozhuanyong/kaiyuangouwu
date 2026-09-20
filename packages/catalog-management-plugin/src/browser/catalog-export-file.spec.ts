import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadCatalogBlob, exportCatalogRowsLocally } from './catalog-export-file';

describe('catalog browser download', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the object URL alive until after the browser receives the attached download link', () => {
        const click = vi.fn();
        const remove = vi.fn();
        const append = vi.fn();
        const revokeObjectURL = vi.fn();
        const setTimeout = vi.fn((callback: () => void) => {
            callback();
            return 1;
        });
        const anchor = { href: '', download: '', style: { display: '' }, click, remove };
        vi.stubGlobal('document', {
            createElement: vi.fn(() => anchor),
            body: { append },
        });
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:catalog-export'),
            revokeObjectURL,
        });
        vi.stubGlobal('window', { setTimeout });

        downloadCatalogBlob(new Blob(['sku']), 'catalog.csv');

        expect(anchor).toMatchObject({
            href: 'blob:catalog-export',
            download: 'catalog.csv',
            style: { display: 'none' },
        });
        expect(append).toHaveBeenCalledWith(anchor);
        expect(click).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1_000);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:catalog-export');
        expect(append.mock.invocationCallOrder[0]).toBeLessThan(click.mock.invocationCallOrder[0]);
        expect(click.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    });

    it('falls back to the main thread when the browser cannot start the export worker', async () => {
        const terminate = vi.fn();
        class BrokenWorker {
            onmessage: ((event: MessageEvent) => void) | null = null;
            onmessageerror: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: ErrorEvent) => void) | null = null;
            terminate = terminate;

            postMessage() {
                queueMicrotask(() => this.onerror?.({ message: '' } as ErrorEvent));
            }
        }
        vi.stubGlobal('Worker', BrokenWorker);
        vi.stubGlobal('window', {
            setTimeout,
            clearTimeout,
        });

        const result = await exportCatalogRowsLocally([], 'csv');

        expect(result.extension).toBe('csv');
        expect(result.blob.type).toBe('text/csv;charset=utf-8');
        expect(result.blob.size).toBeGreaterThan(0);
        expect(terminate).toHaveBeenCalledOnce();
    });
});

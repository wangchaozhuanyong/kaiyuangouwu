import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    measurePublicDocument,
    measurePublicDocumentSync,
    publicDocumentTimingHeader,
    recordPublicDocumentCache,
    withPublicDocumentTiming,
} from './public-document-timing';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());

describe('request-local public document timing', () => {
    it('isolates interleaved requests and leaves non-document reads untouched', async () => {
        const a = deferred();
        const b = deferred();
        const first = withPublicDocumentTiming(async () => {
            recordPublicDocumentCache('hit');
            await measurePublicDocument('page-loader-config', () => a.promise);
            return publicDocumentTimingHeader();
        });
        const second = withPublicDocumentTiming(async () => {
            recordPublicDocumentCache('miss');
            await measurePublicDocument('page-loader-content', () => b.promise);
            return publicDocumentTimingHeader();
        });
        b.resolve();
        const secondHeader = (await second).join(', ');
        a.resolve();
        const firstHeader = (await first).join(', ');
        expect(firstHeader).toContain('storefront-page-loader-config;dur=');
        expect(firstHeader).toContain('desc="hit"');
        expect(firstHeader).not.toContain('content');
        expect(secondHeader).toContain('storefront-page-loader-content;dur=');
        expect(secondHeader).toContain('desc="miss"');
        expect(secondHeader).not.toContain('config');
        expect(publicDocumentTimingHeader()).toEqual([]);
        expect(measurePublicDocument('page-read', () => a.promise)).toBe(a.promise);
    });

    it('retains values and original failures and records failed phases', async () => {
        await withPublicDocumentTiming(async () => {
            const value = {};
            expect(await measurePublicDocument('page-read', () => Promise.resolve(value))).toBe(value);
            const error = new Error('synthetic private identifier');
            await expect(measurePublicDocument('render-react', () => Promise.reject(error))).rejects.toBe(
                error,
            );
            expect(() =>
                measurePublicDocumentSync('render-assemble', () => {
                    throw error;
                }),
            ).toThrow(error);
            const header = publicDocumentTimingHeader().join(', ');
            expect(header).toContain('storefront-render-react;dur=');
            expect(header).toContain('storefront-render-assemble;dur=');
            expect(header).not.toContain(error.message);
        });
    });

    it('does not let broken clocks change the read result or rejection', async () => {
        await withPublicDocumentTiming(async () => {
            vi.spyOn(performance, 'now').mockImplementation(() => {
                throw new Error('clock unavailable');
            });
            expect(await measurePublicDocument('page-read', () => Promise.resolve(7))).toBe(7);
            const error = new Error('original failure');
            await expect(measurePublicDocument('render-react', () => Promise.reject(error))).rejects.toBe(
                error,
            );
            expect(publicDocumentTimingHeader()).toEqual([]);
        });
    });

    it('bounds names, outcomes and durations and ignores work finishing after response sealing', async () => {
        await withPublicDocumentTiming(async () => {
            let now = 0;
            vi.spyOn(performance, 'now').mockImplementation(() => now);
            const late = deferred();
            const work = measurePublicDocument('page-loader-content', () => late.promise);
            measurePublicDocumentSync('render-assemble', () => {
                now = 1_000_000;
            });
            recordPublicDocumentCache('hit');
            recordPublicDocumentCache('join');
            recordPublicDocumentCache('secret";desc="unsafe' as never);
            measurePublicDocumentSync('private-host' as never, () => undefined);
            const header = publicDocumentTimingHeader();
            expect(header).toEqual([
                'storefront-render-assemble;dur=120000.0',
                'storefront-page-cache;desc="mixed"',
            ]);
            late.resolve();
            await work;
            recordPublicDocumentCache('bypass');
            expect(publicDocumentTimingHeader()).toEqual(header);
        });
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireBodyScrollLock } from './scroll-lock';

function createDocument() {
    return {
        documentElement: {
            clientWidth: 980,
            style: { overflow: 'auto' },
        },
        body: {
            style: { overflow: 'visible', paddingRight: '4px' },
        },
    } as unknown as Document;
}

describe('body scroll lock', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('compensates for a native scrollbar and restores the original styles', () => {
        const fakeDocument = createDocument();
        vi.stubGlobal('document', fakeDocument);
        vi.stubGlobal('window', { innerWidth: 1000 });

        const release = acquireBodyScrollLock();

        expect(fakeDocument.documentElement.style.overflow).toBe('hidden');
        expect(fakeDocument.body.style.overflow).toBe('hidden');
        expect(fakeDocument.body.style.paddingRight).toBe('calc(4px + 20px)');

        release();

        expect(fakeDocument.documentElement.style.overflow).toBe('auto');
        expect(fakeDocument.body.style.overflow).toBe('visible');
        expect(fakeDocument.body.style.paddingRight).toBe('4px');
    });

    it('keeps nested locks active until the last sheet closes', () => {
        const fakeDocument = createDocument();
        vi.stubGlobal('document', fakeDocument);
        vi.stubGlobal('window', { innerWidth: 1000 });

        const releaseFirst = acquireBodyScrollLock();
        const releaseSecond = acquireBodyScrollLock();

        releaseFirst();
        expect(fakeDocument.body.style.overflow).toBe('hidden');

        releaseSecond();
        releaseSecond();
        expect(fakeDocument.body.style.overflow).toBe('visible');
    });
});

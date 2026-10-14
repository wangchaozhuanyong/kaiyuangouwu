import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireBodyScrollLock } from './scroll-lock';

function createDocument(stableGutter = false) {
    const rootStyle = { overflow: 'auto' };
    return {
        documentElement: {
            get clientWidth() {
                return rootStyle.overflow === 'hidden' && !stableGutter ? 1000 : 980;
            },
            getBoundingClientRect() {
                return { width: rootStyle.overflow === 'hidden' && !stableGutter ? 1000 : 980 };
            },
            style: rootStyle,
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

    it('keeps the existing padding when a stable gutter retains the layout width', () => {
        const fakeDocument = createDocument(true);
        vi.stubGlobal('document', fakeDocument);
        const release = acquireBodyScrollLock();
        try {
            expect(fakeDocument.documentElement.clientWidth).toBe(980);
            expect(fakeDocument.body.style.paddingRight).toBe('4px');
        } finally {
            release();
        }
        expect(fakeDocument.body.style.paddingRight).toBe('4px');
        expect(fakeDocument.documentElement.style.overflow).toBe('auto');
    });
});

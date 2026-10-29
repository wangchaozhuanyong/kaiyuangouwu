import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('./auth-overlay');
    vi.doUnmock('./auth-pages');
    vi.resetModules();
});

describe('authentication code preparation', () => {
    it('starts the dialog and forms in parallel, before either download finishes', async () => {
        const started: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.doMock('./auth-overlay', async () => {
            started.push('dialog');
            await gate;
            return {};
        });
        vi.doMock('./auth-pages', async () => {
            started.push('forms');
            await gate;
            return {};
        });
        const { preloadAuthOverlay } = await import('./auth-overlay-preload');
        const loading = preloadAuthOverlay();
        try {
            await vi.waitFor(() => expect(started.sort()).toEqual(['dialog', 'forms']));
        } finally {
            release();
            await loading;
        }
    });

    it('leaves optional preload failures to the visible lazy boundary', async () => {
        vi.doMock('./auth-overlay', () => {
            throw new Error('Synthetic offline import');
        });
        vi.doMock('./auth-pages', () => ({}));
        const { preloadAuthOverlay } = await import('./auth-overlay-preload');
        await expect(preloadAuthOverlay()).resolves.toBeUndefined();
    });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSandboxPreviewImage } from './storefront-preview-image';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.unstubAllGlobals();
});

function Preview({ source }: { source: string }) {
    const image = useSandboxPreviewImage(source);
    return (
        <img
            alt="preview"
            src={image.url || undefined}
            data-inline={image.inline}
            data-loading={image.loading}
            data-error={image.error}
        />
    );
}

async function harness(source: string) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    cleanups.push(() => root.unmount());
    const render = async (next: string) => {
        await act(async () => root.render(<Preview source={next} />));
    };
    await render(source);
    return { container, render };
}

async function settled(container: HTMLElement, expectation: (image: HTMLImageElement) => void) {
    await vi.waitFor(async () => {
        await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
        expectation(container.querySelector('img')!);
    });
}

describe('opaque carousel preview images', () => {
    it('reads a local managed image with the parent session and embeds only image bytes', async () => {
        const fetchImage = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => new Blob(['preview pixels'], { type: 'image/webp' }),
        });
        vi.stubGlobal('fetch', fetchImage);
        const { container } = await harness('/assets/preview/hero.png?preset=storefront-hero-fit-1600');
        await settled(container, image => {
            expect(image.getAttribute('src')).toBe('data:image/webp;base64,cHJldmlldyBwaXhlbHM=');
            expect(image.dataset.loading).toBe('false');
            expect(image.dataset.error).toBe('false');
        });
        expect(fetchImage).toHaveBeenCalledWith(
            '/assets/preview/hero.png?preset=storefront-hero-fit-1600',
            expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }),
        );
    });

    it('leaves public external images direct and does not send the admin session to another host', async () => {
        const fetchImage = vi.fn();
        vi.stubGlobal('fetch', fetchImage);
        const { container } = await harness('https://public-shop.example/assets/preview/hero.png');
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
            'https://public-shop.example/assets/preview/hero.png',
        );
        expect(fetchImage).not.toHaveBeenCalled();
    });

    it.each([
        { ok: false, blob: async () => new Blob([], { type: 'image/webp' }) },
        { ok: true, blob: async () => new Blob(['denied'], { type: 'text/html' }) },
    ])('shows a failed preview without embedding a denied or non-image response', async response => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const { container } = await harness('/assets/preview/denied.png');
        await settled(container, image => {
            expect(image.dataset.error).toBe('true');
            expect(image.getAttribute('src')).toBeNull();
        });
    });

    it('aborts the previous read when changing slides and discards its late result', async () => {
        let resolveOld: (response: unknown) => void = () => undefined;
        const fetchImage = vi.fn().mockImplementation(
            () =>
                new Promise(resolve => {
                    resolveOld = resolve;
                }),
        );
        vi.stubGlobal('fetch', fetchImage);
        const { container, render } = await harness('/assets/preview/old.png');
        const oldSignal = fetchImage.mock.calls[0][1].signal as AbortSignal;
        await render('https://public-shop.example/new.png');
        expect(oldSignal.aborted).toBe(true);
        await act(async () => {
            resolveOld({ ok: true, blob: async () => new Blob(['old'], { type: 'image/webp' }) });
        });
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
            'https://public-shop.example/new.png',
        );
    });
});

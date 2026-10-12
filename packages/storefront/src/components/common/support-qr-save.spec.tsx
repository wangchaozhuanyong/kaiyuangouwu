// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportQrSave } from './support-qr-save';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('QR image saving by browser capability', () => {
    let host: HTMLDivElement;
    let root: Root;
    let download: ReturnType<typeof vi.spyOn>;
    const share = vi.fn<(data: ShareData) => Promise<void>>();
    const canShare = vi.fn<(data?: ShareData) => boolean>();
    const render = async (mobile = true) => {
        vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(mobile ? 1 : 0);
        await act(async () => {
            root.render(<SupportQrSave imageUrl="/support-qr.png" language="zh" />);
            await Promise.resolve();
        });
    };
    const click = () =>
        act(async () => {
            const button = host.querySelector<HTMLButtonElement>('button');
            if (!button) throw new Error('Required QR-save fixture button is missing');
            button.click();
            await Promise.resolve();
        });
    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 0 });
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                blob: () => Promise.resolve(new Blob(['qr'], { type: 'image/png' })),
            }),
        );
        share.mockReset().mockResolvedValue(undefined);
        canShare.mockReset().mockReturnValue(true);
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: share,
        });
        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: canShare,
        });
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: vi.fn().mockReturnValue('blob:qr'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
        download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete (navigator as unknown as Record<string, unknown>).share;
        delete (navigator as unknown as Record<string, unknown>).canShare;
    });
    it('shares a prepared image file directly from the mobile gesture', async () => {
        await render();
        expect(host.textContent).toContain('打开系统分享');
        await click();
        expect(share).toHaveBeenCalledWith({
            files: [expect.objectContaining({ name: 'support-qr.png', type: 'image/png' })],
        });
        expect(download).not.toHaveBeenCalled();
    });
    it('does not turn cancelled sharing into a download', async () => {
        share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
        await render();
        await click();
        expect(host.textContent).toContain('分享已关闭');
        expect(download).not.toHaveBeenCalled();
    });
    it('leaves unsupported mobile devices on native long-press preview', async () => {
        canShare.mockReturnValue(false);
        await render();
        expect(host.querySelector('button')).toBeNull();
        expect(share).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
    });
    it.each(['share', 'canShare'])('keeps the preview usable when %s is unavailable', async capability => {
        Object.defineProperty(navigator, capability, { configurable: true, value: undefined });
        await render();
        expect(host.querySelector('button')).toBeNull();
        expect(download).not.toHaveBeenCalled();
    });
    it('keeps a failed share retryable without downloading', async () => {
        share.mockRejectedValue(new Error('Unavailable'));
        await render();
        await click();
        expect(host.textContent).toContain('无法打开系统分享');
        expect(host.querySelector('button')?.disabled).toBe(false);
        expect(download).not.toHaveBeenCalled();
    });
    it('downloads the prepared original file on desktop', async () => {
        await render(false);
        await click();
        expect(download).toHaveBeenCalledOnce();
        expect(share).not.toHaveBeenCalled();
    });
    it('retries failed preparation and rejects non-image responses', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            blob: () => Promise.resolve(new Blob(['error'], { type: 'text/html' })),
        } as Response);
        await render();
        expect(host.textContent).toContain('重新准备图片');
        await click();
        expect(host.textContent).toContain('打开系统分享');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(download).not.toHaveBeenCalled();
    });
});

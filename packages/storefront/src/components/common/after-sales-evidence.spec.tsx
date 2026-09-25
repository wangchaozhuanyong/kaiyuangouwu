// @vitest-environment jsdom
/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfterSalesEvidence } from '../../types';

import { AfterSalesEvidenceUploader } from './after-sales-evidence';
/* eslint-enable import/order */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('private after-sales evidence selection', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    const api = {
        afterSalesEvidenceDrafts: vi.fn(),
        uploadAfterSalesEvidence: vi.fn(),
        removeAfterSalesEvidenceDraft: vi.fn(),
    };
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    const onReadyChange = vi.fn();
    const row = (id: string): AfterSalesEvidence => ({
        id,
        createdAt: '2026-09-24T00:00:00Z',
        mimeType: 'image/png',
        byteSize: 12,
        available: true,
        previewUrl: null,
        expiresAt: null,
    });
    const button = (name: string) => {
        const found = [...host.querySelectorAll('button')].find(item => item.textContent === name);
        if (!found) throw new Error(`Missing button: ${name}`);
        return found;
    };
    const mount = async () => {
        await act(async () => {
            root.render(
                <AfterSalesEvidenceUploader
                    api={api}
                    orderId="order-1"
                    language="zh"
                    disabled={false}
                    onChange={onChange}
                    onBusyChange={onBusyChange}
                    onReadyChange={onReadyChange}
                />,
            );
            await Promise.resolve();
        });
    };
    const select = async (files: File[]) => {
        const input = host.querySelector('input');
        if (!input) throw new Error('Evidence file input is missing');
        Object.defineProperty(input, 'files', { configurable: true, value: files });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
    };
    beforeEach(() => {
        vi.resetAllMocks();
        api.afterSalesEvidenceDrafts.mockResolvedValue([]);
        api.removeAfterSalesEvidenceDraft.mockResolvedValue(true);
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('blocks selection and submission readiness when draft loading fails, then recovers on retry', async () => {
        api.afterSalesEvidenceDrafts.mockRejectedValueOnce(new Error('Connection unavailable'));
        await mount();
        expect(button('添加图片').disabled).toBe(true);
        expect(onReadyChange).toHaveBeenLastCalledWith(false);
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        api.afterSalesEvidenceDrafts.mockResolvedValue([row('restored')]);
        await act(async () => {
            button('刷新凭证').click();
            await Promise.resolve();
        });
        expect(onChange).toHaveBeenLastCalledWith(['restored']);
        expect(onReadyChange).toHaveBeenLastCalledWith(true);
        expect(button('添加图片').disabled).toBe(false);
    });

    it('reconciles a timed-out upload with the server before enabling submission', async () => {
        await mount();
        api.uploadAfterSalesEvidence.mockRejectedValueOnce(new Error('Upload timed out'));
        api.afterSalesEvidenceDrafts.mockResolvedValueOnce([row('saved-despite-timeout')]);
        await select([new File(['fixture'], 'receipt.png', { type: 'image/png' })]);
        expect(api.uploadAfterSalesEvidence).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenLastCalledWith(['saved-despite-timeout']);
        expect(onReadyChange).toHaveBeenLastCalledWith(true);
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('keeps submission blocked when an uncertain upload cannot be reconciled', async () => {
        await mount();
        api.uploadAfterSalesEvidence.mockRejectedValueOnce(new Error('Upload timed out'));
        api.afterSalesEvidenceDrafts.mockRejectedValueOnce(new Error('Network unavailable'));
        await select([new File(['fixture'], 'receipt.png', { type: 'image/png' })]);
        expect(onReadyChange).toHaveBeenLastCalledWith(false);
        expect(button('添加图片').disabled).toBe(true);
    });

    it('rejects over-limit selections without uploading and only removes a draft after acknowledgement', async () => {
        api.afterSalesEvidenceDrafts.mockResolvedValue([row('first'), row('second')]);
        await mount();
        await select(
            Array.from({ length: 5 }, () => new File(['fixture'], 'receipt.png', { type: 'image/png' })),
        );
        expect(api.uploadAfterSalesEvidence).not.toHaveBeenCalled();
        api.removeAfterSalesEvidenceDraft.mockRejectedValueOnce(new Error('Network unavailable'));
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="移除凭证 1"]')?.click();
            await Promise.resolve();
        });
        expect(onChange).toHaveBeenLastCalledWith(['first', 'second']);
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="移除凭证 1"]')?.click();
            await Promise.resolve();
        });
        expect(onChange).toHaveBeenLastCalledWith(['second']);
    });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAdminFiles } from '../apollo';
import { AdminPermissionsContext } from '../hooks/use-admin-permissions';
import { ImageAssetUploadButton } from './ImageAssetUploadButton';

vi.mock('../apollo', () => ({ uploadAdminFiles: vi.fn() }));

const upload = vi.mocked(uploadAdminFiles);
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    upload.mockReset();
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

async function chooseFiles(files: File[]) {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

function renderButton(
    onUploaded = vi.fn(),
    options: { multiple?: boolean; canCreate?: boolean; channelToken?: string } = {},
) {
    const canCreate = options.canCreate ?? true;
    act(() => {
        root.render(
            <AdminPermissionsContext.Provider
                value={{
                    permissions: [],
                    hasAnyPermission: () => canCreate,
                }}
            >
                <ImageAssetUploadButton
                    multiple={options.multiple}
                    channelToken={options.channelToken}
                    onUploaded={onUploaded}
                />
            </AdminPermissionsContext.Provider>,
        );
    });
    return onUploaded;
}

describe('ImageAssetUploadButton', () => {
    it('uploads a valid image into the requested asset library and returns the created asset', async () => {
        const created = {
            __typename: 'Asset',
            id: 'asset-1',
            name: 'hero.png',
            preview: '/hero-preview.png',
            source: '/hero.png',
            type: 'IMAGE',
            mimeType: 'image/png',
        };
        upload.mockResolvedValue({ createAssets: [created] });
        const onUploaded = renderButton(vi.fn(), { channelToken: 'store-b' });

        await chooseFiles([new File(['image'], 'hero.png', { type: 'image/png' })]);

        expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.any(Function), {
            channelToken: 'store-b',
        });
        expect(onUploaded).toHaveBeenCalledWith([created]);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('supports multiple gallery images and rejects unsupported files before upload', async () => {
        upload.mockResolvedValue({
            createAssets: [
                {
                    __typename: 'Asset',
                    id: 'asset-1',
                    name: 'one.png',
                    preview: '/one-preview.png',
                    source: '/one.png',
                    type: 'IMAGE',
                },
                {
                    __typename: 'Asset',
                    id: 'asset-2',
                    name: 'two.webp',
                    preview: '/two-preview.webp',
                    source: '/two.webp',
                    type: 'IMAGE',
                },
            ],
        });
        const onUploaded = renderButton(vi.fn(), { multiple: true });
        await chooseFiles([
            new File(['one'], 'one.png', { type: 'image/png' }),
            new File(['two'], 'two.webp', { type: 'image/webp' }),
        ]);
        expect(onUploaded).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: 'asset-1' }),
                expect.objectContaining({ id: 'asset-2' }),
            ]),
        );

        upload.mockClear();
        await chooseFiles([new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })]);
        expect(upload).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('仅支持 JPG、PNG 或 WebP');
    });

    it('keeps the upload action visible but disabled without asset creation permission', () => {
        renderButton(vi.fn(), { canCreate: false });
        const button = host.querySelector<HTMLButtonElement>('button[aria-label="上传图片"]')!;
        expect(button.disabled).toBe(true);
        expect(button.title).toContain('需要素材创建权限');
    });
});

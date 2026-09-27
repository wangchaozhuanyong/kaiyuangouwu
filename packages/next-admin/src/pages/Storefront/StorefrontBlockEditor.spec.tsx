// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { newContentBlock } from './storefront-content-utils';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';

vi.mock('@apollo/client/react', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => false }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./storefront-block-preview', () => ({ BlockPreview: () => null }));
vi.mock('./storefront-asset-picker', () => ({
    AssetPicker: ({ label, onChange }: any) => (
        <>
            <button
                onClick={() =>
                    onChange({ id: 'replacement', name: 'replacement.png', preview: '/replacement.png' })
                }
            >
                {label}换图
            </button>
            <button onClick={() => onChange(null)}>{label}清除</button>
        </>
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('requires image review, invalidates it after another image change, and preserves normal saves', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn(async () => undefined);
    const value = {
        ...newContentBlock('STORY', 0),
        id: 'saved',
        imageAssetId: 'merchant',
        imageAsset: {
            id: 'merchant',
            name: 'merchant.png',
            source: '/merchant.png',
            preview: '/merchant.png',
        },
        imageUrl: '/merchant.png',
    };
    value.translations[0].title = '品牌介绍';
    value.targetType = 'NONE';
    const button = (name: string) =>
        Array.from(host.querySelectorAll('button')).find(item => item.textContent === name)!;
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        expect(button('保存并核对').disabled).toBe(false);
        await act(async () => button('保存并核对').click());
        expect(onSave).toHaveBeenLastCalledWith(expect.anything(), false);
        await act(async () => button('主图素材换图').click());
        expect(button('保存并核对').disabled).toBe(true);
        const checkbox = () =>
            Array.from(host.querySelectorAll('label'))
                .find(label => label.textContent?.includes('我确认替换或清除以上图片'))!
                .querySelector('input')!;
        await act(async () => checkbox().click());
        expect(button('保存并核对').disabled).toBe(false);
        await act(async () => button('主图素材清除').click());
        expect(checkbox().checked).toBe(false);
        expect(button('保存并核对').disabled).toBe(true);
        await act(async () => button('主图素材换图').click());
        expect(checkbox().checked).toBe(false);
        expect(button('保存并核对').disabled).toBe(true);
        await act(async () => button('主图素材清除').click());
        await act(async () => checkbox().click());
        await act(async () => button('保存并核对').click());
        expect(onSave).toHaveBeenLastCalledWith(
            expect.objectContaining({ imageAssetId: null, imageUrl: null }),
            true,
        );
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

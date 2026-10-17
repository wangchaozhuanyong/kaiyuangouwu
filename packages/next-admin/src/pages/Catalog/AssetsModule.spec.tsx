// @vitest-environment jsdom

import type { DocumentNode } from 'graphql';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { UPDATE_ASSET } from '../../graphql/catalog-admin.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import type { AdminPermission } from '../../utils/admin-permissions';
import { AssetsModule, assetTranslationsWithSourceName, countUploadedAssets } from './AssetsModule';

const mocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
    deleteAssets: vi.fn(),
    refetch: vi.fn(),
    requestConfirmation: vi.fn(),
    assets: [] as Array<Record<string, unknown>>,
    permissions: [] as AdminPermission[],
}));

vi.mock('@apollo/client/react', () => ({
    useMutation: (document: DocumentNode) => {
        mocks.useMutation(document);
        const operation = document.definitions.find(definition => definition.kind === 'OperationDefinition');
        const mutate =
            operation?.name?.value === 'UpdateCatalogAsset'
                ? mocks.updateAsset
                : operation?.name?.value === 'DeleteCatalogAsset'
                  ? mocks.deleteAsset
                  : mocks.deleteAssets;
        return [mutate, { loading: false }];
    },
}));
// This component fixture checks the save callback; shared query/cache lifecycle has real-Apollo coverage.
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({
        data: { assets: { items: mocks.assets, totalItems: mocks.assets.length } },
        loading: false,
        refetch: mocks.refetch,
    }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

describe('asset source-language name save', () => {
    it('updates the Chinese translation instead of resubmitting the old name', () => {
        const input = [
            { id: 'zh', languageCode: 'zh_Hans', name: '旧素材.png' },
            { id: 'en', languageCode: 'en', name: 'Manually maintained English' },
        ];
        expect(assetTranslationsWithSourceName(input, '新素材.png')).toEqual([
            { id: 'zh', languageCode: 'zh_Hans', name: '新素材.png' },
            input[1],
        ]);
        expect(input[0].name).toBe('旧素材.png');
    });
    it('adds the Chinese translation for an English-only legacy asset', () => {
        const english = { id: 'en', languageCode: 'en', name: 'Original' };
        expect(assetTranslationsWithSourceName([english], '中文素材')).toEqual([
            english,
            { languageCode: 'zh_Hans', name: '中文素材' },
        ]);
    });
    it('supports an asset with no translations without passing output-only properties', () => {
        expect(assetTranslationsWithSourceName([], '新素材')).toEqual([
            { languageCode: 'zh_Hans', name: '新素材' },
        ]);
    });
});

describe('asset upload result count', () => {
    it('counts successful API results once, independently of React state updater replays', () => {
        const results = [{ __typename: 'Asset' as const, id: 'test' }];
        expect(countUploadedAssets(results, 1)).toBe(1);
        expect(countUploadedAssets(results, 1)).toBe(1);
    });
    it('ignores failed, missing and unrequested results', () => {
        expect(
            countUploadedAssets(
                [{ __typename: 'Asset' }, { __typename: 'MimeTypeError' }, { __typename: 'Asset' }],
                2,
            ),
        ).toBe(1);
        expect(countUploadedAssets([], 1)).toBe(0);
    });
});

describe('asset classification editing', () => {
    let host: HTMLDivElement;
    let root: Root;

    const originalTags = [
        '后台上传',
        '来源:商品装修',
        'sha256:fixture-content-hash',
        'managed:product:fixture-cover',
        '商家自定义标签',
        '素材分类:商品图',
    ];

    beforeEach(() => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        vi.clearAllMocks();
        mocks.permissions = ['ReadAsset', 'CreateAsset', 'UpdateAsset', 'DeleteAsset'];
        mocks.updateAsset.mockResolvedValue({ data: { updateAsset: { id: 'asset-1' } } });
        mocks.refetch.mockResolvedValue({});
        mocks.assets = [
            {
                id: 'asset-1',
                name: '商品封面.png',
                type: 'IMAGE',
                fileSize: 4096,
                mimeType: 'image/png',
                width: 800,
                height: 800,
                preview: '/assets/fixture-cover.png',
                source: '/assets/fixture-cover-original.png',
                tags: originalTags.map((value, index) => ({ id: `tag-${index}`, value })),
                translations: [{ id: 'translation-zh', languageCode: 'zh_Hans', name: '商品封面.png' }],
            },
        ];
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const button = (label: string) => {
        const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
            candidate =>
                candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
        );
        expect(found, `button ${label}`).toBeDefined();
        return found!;
    };

    const openEditor = async () => {
        await act(async () =>
            root.render(
                <AdminPermissionsContext.Provider
                    value={{
                        permissions: mocks.permissions,
                        hasAnyPermission: required =>
                            required.length === 0 || required.some(p => mocks.permissions.includes(p)),
                    }}
                >
                    <ConfirmDialogContext.Provider value={mocks.requestConfirmation}>
                        <AssetsModule />
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>,
            ),
        );
        await act(async () => button('商品封面.png800×8004 KB').click());
        const category = host.querySelector<HTMLSelectElement>('select[aria-label="素材分类"]');
        expect(category).not.toBeNull();
        expect(category!.value).toBe('PRODUCT');
        return category!;
    };

    it('saves a replacement category through updateAsset while retaining provenance and merchant tags', async () => {
        const category = await openEditor();
        await act(async () => {
            category.value = 'QUICK_LINK';
            category.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(mocks.updateAsset).not.toHaveBeenCalled();

        await act(async () => button('保存属性').click());

        expect(mocks.useMutation).toHaveBeenCalledWith(UPDATE_ASSET);
        expect(mocks.updateAsset).toHaveBeenCalledTimes(1);
        expect(mocks.updateAsset).toHaveBeenCalledWith({
            variables: {
                input: {
                    id: 'asset-1',
                    name: '商品封面.png',
                    tags: [...originalTags.slice(0, -1), '素材分类:金刚区'],
                    customFields: {},
                    translations: [
                        {
                            id: 'translation-zh',
                            languageCode: 'zh_Hans',
                            name: '商品封面.png',
                            customFields: {},
                        },
                    ],
                },
            },
        });
        expect(mocks.refetch).toHaveBeenCalledTimes(1);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        expect(mocks.assets[0].tags).toEqual(
            originalTags.map((value, index) => ({ id: `tag-${index}`, value })),
        );
        expect(mocks.deleteAsset).not.toHaveBeenCalled();
        expect(mocks.deleteAssets).not.toHaveBeenCalled();
    });

    it('discards an unsaved category change when closed and restores the saved category on reopening', async () => {
        const category = await openEditor();
        await act(async () => {
            category.value = 'OTHER';
            category.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => button('关闭素材属性').click());

        expect(host.querySelector('[role="dialog"]')).toBeNull();
        expect(mocks.updateAsset).not.toHaveBeenCalled();
        expect(mocks.refetch).not.toHaveBeenCalled();
        await act(async () => button('商品封面.png800×8004 KB').click());
        expect(host.querySelector<HTMLSelectElement>('select[aria-label="素材分类"]')!.value).toBe('PRODUCT');
        expect(mocks.updateAsset).not.toHaveBeenCalled();
    });

    const hasButton = (label: string) =>
        Array.from(host.querySelectorAll('button')).some(
            candidate =>
                candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
        );

    it('keeps asset details and copy available to a read-only employee without write controls', async () => {
        mocks.permissions = ['ReadAsset'];
        const category = await openEditor();
        expect(category.disabled).toBe(true);
        expect(
            Array.from(host.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.value === '商品封面.png')
                .every(input => input.readOnly),
        ).toBe(true);
        expect(host.querySelector('textarea')?.readOnly).toBe(true);
        expect(host.querySelector('input[type="checkbox"]')).toBeNull();
        for (const label of ['上传新素材', '保存属性', '删除素材', '批量删除'])
            expect(hasButton(label)).toBe(false);
        expect(hasButton('复制素材地址')).toBe(true);
        expect(mocks.updateAsset).not.toHaveBeenCalled();
        expect(mocks.deleteAsset).not.toHaveBeenCalled();
        expect(mocks.deleteAssets).not.toHaveBeenCalled();
    });

    it('allows metadata editing without exposing upload or deletion to an update-only role', async () => {
        mocks.permissions = ['ReadAsset', 'UpdateAsset'];
        const category = await openEditor();
        expect(category.disabled).toBe(false);
        expect(hasButton('保存属性')).toBe(true);
        for (const label of ['上传新素材', '删除素材', '批量删除']) expect(hasButton(label)).toBe(false);
        expect(host.querySelector('input[type="checkbox"]')).toBeNull();
        await act(async () => button('保存属性').click());
        expect(mocks.updateAsset).toHaveBeenCalledTimes(1);
    });

    it('exposes deletion independently of metadata editing or uploading', async () => {
        mocks.permissions = ['ReadAsset', 'DeleteAsset'];
        const category = await openEditor();
        expect(category.disabled).toBe(true);
        expect(hasButton('删除素材')).toBe(true);
        expect(hasButton('批量删除')).toBe(true);
        expect(host.querySelector('input[type="checkbox"]')).not.toBeNull();
        expect(hasButton('保存属性')).toBe(false);
        expect(hasButton('上传新素材')).toBe(false);
        expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    });

    it('exposes uploading independently of editing and deletion', async () => {
        mocks.permissions = ['ReadAsset', 'CreateAsset'];
        const category = await openEditor();
        expect(category.disabled).toBe(true);
        expect(hasButton('上传新素材')).toBe(true);
        for (const label of ['保存属性', '删除素材', '批量删除']) expect(hasButton(label)).toBe(false);
        await act(async () => button('关闭素材属性').click());
        await act(async () => button('上传新素材').click());
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain('上传');
        expect(mocks.updateAsset).not.toHaveBeenCalled();
    });
    it('honors the native Catalog aliases for asset operations', async () => {
        mocks.permissions = ['ReadCatalog', 'CreateCatalog', 'UpdateCatalog', 'DeleteCatalog'];
        const category = await openEditor();
        expect(category.disabled).toBe(false);
        for (const label of ['上传新素材', '保存属性', '删除素材', '批量删除'])
            expect(hasButton(label)).toBe(true);
    });
});

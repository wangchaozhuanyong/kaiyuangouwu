// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { CategoriesModule } from './CategoriesModule';

const oldImage = { __typename: 'Asset', id: 'old-image', name: '原分类图', preview: '/old.png' };
const newImage = {
    __typename: 'Asset',
    id: 'new-image',
    name: '新分类图',
    preview: '/new.png',
    source: '/new.png',
    type: 'IMAGE',
    fileSize: 100,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    tags: [],
    translations: [],
};
const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderCategories({ canReadAssets = true, assetError = false, saveError = false } = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let featuredAsset: typeof oldImage | null = oldImage;
    const requests = vi.fn();
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests(operation.operationName, operation.variables);
                    if (operation.operationName === 'GetCatalogTaxonomy') {
                        observer.next({
                            data: {
                                collections: {
                                    totalItems: 1,
                                    items: [
                                        {
                                            __typename: 'Collection',
                                            id: 'category-1',
                                            name: '茶叶',
                                            slug: 'tea',
                                            description: '',
                                            isPrivate: false,
                                            parentId: null,
                                            position: 0,
                                            productVariantCount: 0,
                                            inheritFilters: true,
                                            filters: [],
                                            featuredAsset,
                                            translations: [
                                                {
                                                    id: 'translation-1',
                                                    languageCode: 'zh_Hans',
                                                    name: '茶叶',
                                                    slug: 'tea',
                                                    description: '',
                                                },
                                            ],
                                        },
                                    ],
                                },
                                productOptionGroups: { totalItems: 0, items: [] },
                                facets: { totalItems: 0, items: [] },
                                activeChannel: { id: 'channel-1', defaultLanguageCode: 'zh_Hans' },
                                collectionFilters: [],
                            },
                        });
                    } else if (operation.operationName === 'GetAssets') {
                        if (assetError) {
                            observer.error(new Error('图片加载失败，请重试'));
                            return;
                        }
                        const searched = operation.variables.options.filter.name?.contains;
                        observer.next({
                            data: {
                                assets: { totalItems: searched ? 0 : 1, items: searched ? [] : [newImage] },
                            },
                        });
                    } else if (
                        ['UpdateCatalogCollection', 'CreateCatalogCollection'].includes(
                            operation.operationName ?? '',
                        )
                    ) {
                        if (saveError) {
                            observer.error(new Error('保存失败，请稍后重试'));
                            return;
                        }
                        featuredAsset =
                            operation.variables.input.featuredAssetId === newImage.id
                                ? newImage
                                : operation.variables.input.featuredAssetId === oldImage.id
                                  ? oldImage
                                  : null;
                        const field =
                            operation.operationName === 'UpdateCatalogCollection'
                                ? 'updateCollection'
                                : 'createCollection';
                        observer.next({
                            data: { [field]: { __typename: 'Collection', id: 'category-1', name: '茶叶' } },
                        });
                    } else {
                        observer.error(new Error(`Unexpected operation: ${operation.operationName}`));
                        return;
                    }
                    observer.complete();
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });
    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter>
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <AdminPermissionsContext.Provider
                            value={{ permissions: [], hasAnyPermission: () => canReadAssets }}
                        >
                            <FeatureHelpProvider>
                                <CategoriesModule />
                            </FeatureHelpProvider>
                        </AdminPermissionsContext.Provider>
                    </ConfirmDialogContext.Provider>
                </MemoryRouter>
            </ApolloProvider>,
        );
    });
    const click = async (label: string) => {
        const button = Array.from(container.querySelectorAll('button')).find(
            element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
        );
        expect(button, `button: ${label}`).toBeTruthy();
        await act(async () => button!.click());
    };
    const changeInput = async (input: HTMLInputElement, value: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    return { container, requests, click, changeInput };
}

describe('category image editing', () => {
    it('loads the existing image, saves its replacement, and reads it back without replacing the asset gallery', async () => {
        const { container, requests, click } = await renderCategories();
        await click('编辑分类 茶叶');
        expect(container.querySelector('img[alt="原分类图"]')).not.toBeNull();
        await click('更换图片');
        expect(requests).toHaveBeenCalledWith(
            'GetAssets',
            expect.objectContaining({
                options: expect.objectContaining({ filter: { type: { eq: 'IMAGE' } } }),
            }),
        );
        await click('选择图片：新分类图');
        await click('保存');
        const input = requests.mock.calls.find(([name]) => name === 'UpdateCatalogCollection')?.[1].input;
        expect(input).toMatchObject({ id: 'category-1', featuredAssetId: newImage.id });
        expect(input).not.toHaveProperty('assetIds');
        await click('编辑分类 茶叶');
        expect(container.querySelector('img[alt="新分类图"]')).not.toBeNull();
    });

    it('discards an unsaved replacement and preserves the original image on a normal save', async () => {
        const { container, requests, click } = await renderCategories();
        await click('编辑分类 茶叶');
        await click('更换图片');
        await click('选择图片：新分类图');
        await click('取消');
        expect(requests.mock.calls.some(([name]) => name === 'UpdateCatalogCollection')).toBe(false);
        await click('编辑分类 茶叶');
        expect(container.querySelector('img[alt="原分类图"]')).not.toBeNull();
        await click('保存');
        expect(requests).toHaveBeenCalledWith(
            'UpdateCatalogCollection',
            expect.objectContaining({
                input: expect.objectContaining({ featuredAssetId: oldImage.id }),
            }),
        );
    });

    it('clears only the featured image and starts a new category with no inherited image', async () => {
        const { container, requests, click, changeInput } = await renderCategories();
        await click('编辑分类 茶叶');
        await click('移除图片');
        await click('保存');
        expect(requests).toHaveBeenCalledWith(
            'UpdateCatalogCollection',
            expect.objectContaining({
                input: expect.objectContaining({ featuredAssetId: null }),
            }),
        );
        await click('新增分类');
        expect(container.textContent).toContain('未设置分类图片');
        await changeInput(container.querySelector('[role="dialog"] input')!, '新分类');
        await click('选择图片');
        await click('选择图片：新分类图');
        await click('保存');
        expect(requests).toHaveBeenCalledWith(
            'CreateCatalogCollection',
            expect.objectContaining({
                input: expect.objectContaining({ featuredAssetId: newImage.id }),
            }),
        );
    });

    it('keeps the selected replacement visible when saving fails', async () => {
        const { container, click } = await renderCategories({ saveError: true });
        await click('编辑分类 茶叶');
        await click('更换图片');
        await click('选择图片：新分类图');
        await click('保存');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(container.querySelector('img[alt="新分类图"]')).not.toBeNull();
        expect(container.textContent).toContain('保存失败');
    });

    it('shows asset loading errors with a retry action', async () => {
        const { container, click } = await renderCategories({ assetError: true });
        await click('编辑分类 茶叶');
        await click('更换图片');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('图片加载失败');
        await click('重试');
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('shows an empty search and skips the asset query without read permission', async () => {
        const allowed = await renderCategories();
        await allowed.click('编辑分类 茶叶');
        await allowed.click('更换图片');
        await allowed.changeInput(
            allowed.container.querySelector('[aria-label="搜索分类图片"]')!,
            'no-match',
        );
        expect(allowed.container.textContent).toContain('暂无匹配图片');
        const restricted = await renderCategories({ canReadAssets: false });
        await restricted.click('编辑分类 茶叶');
        expect(restricted.container.textContent).toContain('需要素材读取权限');
        expect(restricted.requests.mock.calls.some(([name]) => name === 'GetAssets')).toBe(false);
    });
});

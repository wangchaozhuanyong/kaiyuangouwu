// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

import { ProductCategorySummary } from './ProductCategorySummary';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';

const editorState = vi.hoisted(() => ({
    selectedFacetValueIds: [],
    setSelectedFacetValueIds: vi.fn(),
    selectedCollectionIds: ['gpt'],
    setSelectedCollectionIds: vi.fn(),
    selectedChannelIds: [],
    setSelectedChannelIds: vi.fn(),
    facetSearch: '',
    setFacetSearch: vi.fn(),
    facetPage: 0,
    setFacetPage: vi.fn(),
    collectionSearch: '',
    setCollectionSearch: vi.fn(),
    toggleFacetValue: vi.fn(),
    facetsData: { facets: { items: [], totalItems: 0 } },
    facetsLoading: false,
    facetsError: null,
    refetchFacets: vi.fn(),
    collectionsData: {
        collections: {
            items: [
                {
                    id: 'subscriptions',
                    name: '订阅服务',
                    slug: 'subscriptions',
                    position: 1,
                    filters: [],
                    children: [
                        {
                            id: 'claude',
                            name: 'Claude订阅',
                            slug: 'claude-subscription',
                            position: 1,
                            filters: [],
                        },
                        {
                            id: 'gpt',
                            name: 'GPT订阅',
                            slug: 'gpt-subscription',
                            position: 2,
                            filters: [],
                        },
                    ],
                },
            ],
            totalItems: 1,
        },
    },
    collectionsLoading: false,
    collectionsError: null,
    refetchCollections: vi.fn(),
    productData: { product: { collections: [] } },
    isCreateMode: false,
    productId: 'product-1',
    saving: false,
}));

vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => editorState,
}));

describe('ProductFacetsCollectionsTab collection hierarchy', () => {
    it('renders first-level groups and their second-level collection choices', () => {
        const markup = renderToStaticMarkup(<ProductFacetsCollectionsTab />);

        expect(markup).toContain('一级分类 1');
        expect(markup).toContain('二级分类 2');
        expect(markup).toContain('已选择 1 个分类');
        expect(markup).toContain('订阅服务');
        expect(markup).toContain('Claude订阅');
        expect(markup).toContain('GPT订阅');
        expect(markup).toContain('aria-label="选择一级分类：订阅服务"');
        expect(markup).toContain('aria-label="取消选择二级分类：GPT订阅"');
    });

    it('keeps category data visible if a background update fails', () => {
        Object.assign(editorState, { collectionsError: new Error('更新失败') });
        try {
            const markup = renderToStaticMarkup(<ProductFacetsCollectionsTab section="category" />);
            expect(markup).toContain('商品分类更新失败');
            expect(markup).toContain('GPT订阅');
            expect(markup).toContain('Claude订阅');
            expect(markup).toContain('重试');
        } finally {
            editorState.collectionsError = null;
        }
    });
});

describe('ProductCategorySummary inline draft selection', () => {
    let root: Root | undefined;
    let host: HTMLDivElement | undefined;
    const originalCollections = editorState.collectionsData;
    const originalProduct = editorState.productData;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = undefined;
        host?.remove();
        host = undefined;
        editorState.selectedCollectionIds = ['gpt'];
        editorState.collectionSearch = '';
        editorState.collectionsLoading = false;
        editorState.collectionsError = null;
        editorState.collectionsData = originalCollections;
        editorState.productData = originalProduct;
        editorState.saving = false;
        vi.clearAllMocks();
    });

    async function renderSummary() {
        await act(async () =>
            root?.render(
                <FeatureHelpProvider>
                    <ProductCategorySummary />
                </FeatureHelpProvider>,
            ),
        );
    }

    async function mountSummary() {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        editorState.setSelectedCollectionIds.mockImplementation(update => {
            editorState.selectedCollectionIds =
                typeof update === 'function' ? update(editorState.selectedCollectionIds) : update;
        });
        editorState.setCollectionSearch.mockImplementation(value => {
            editorState.collectionSearch = value;
        });
        await renderSummary();
    }

    async function click(label: string) {
        const target = host?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        expect(target, label).toBeTruthy();
        await act(async () => target!.click());
        await renderSummary();
    }

    it('updates the existing draft immediately and keeps parent and child selections independent', async () => {
        await mountSummary();
        expect(host?.querySelector('[role="dialog"]')).toBeNull();
        expect(host?.textContent).not.toContain('修改');
        await click('选择一级分类：订阅服务');
        expect(editorState.selectedCollectionIds).toEqual(['gpt', 'subscriptions']);
        expect(
            host?.querySelector<HTMLInputElement>('[aria-label="选择二级分类：Claude订阅"]')?.checked,
        ).toBe(false);
        await click('选择二级分类：Claude订阅');
        await click('取消选择二级分类：GPT订阅');
        expect(editorState.selectedCollectionIds).toEqual(['subscriptions', 'claude']);
        expect(host?.textContent).toContain('已选 2 项');
        expect(host?.textContent).toContain('保存商品后生效');
        expect(editorState.setSelectedCollectionIds).toHaveBeenCalledTimes(3);
    });

    it('shows pending actual membership separately from a saved manual choice', async () => {
        const collections = structuredClone(editorState.collectionsData);
        collections.collections.items[0].children[1].filters = [
            { code: 'product-id-filter', args: [{ name: 'productIds', value: '["product-1"]' }] },
        ] as never[];
        editorState.collectionsData = collections;
        await mountSummary();
        expect(
            host?.querySelector<HTMLInputElement>('[aria-label="取消选择二级分类：GPT订阅"]')?.checked,
        ).toBe(true);
        expect(host?.querySelector('[role="status"]')?.textContent).toContain('分类尚未生效');
        editorState.productData = {
            product: { collections: [collections.collections.items[0].children[1]] },
        } as typeof editorState.productData;
        await renderSummary();
        expect(host?.textContent).not.toContain('分类尚未生效');
    });

    it('searches with the shared control, retains hidden selections and restores their checked state', async () => {
        await mountSummary();
        const search = host!.querySelector<HTMLInputElement>('[aria-label="搜索商品分类或专辑"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Claude');
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await renderSummary();
        expect(editorState.setCollectionSearch).toHaveBeenCalledWith('Claude');
        expect(host?.textContent).toContain('订阅服务');
        expect(host?.textContent).toContain('Claude订阅');
        expect(host?.textContent).not.toContain('GPT订阅');
        expect(host?.textContent).toContain('另有 1 个已选分类');
        expect(editorState.selectedCollectionIds).toEqual(['gpt']);
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        editorState.collectionSearch = '';
        await renderSummary();
        expect(
            host?.querySelector<HTMLInputElement>('[aria-label="取消选择二级分类：GPT订阅"]')?.checked,
        ).toBe(true);
    });

    it('keeps cached choices and missing selected IDs on an update failure and supports local retry', async () => {
        Object.assign(editorState, {
            selectedCollectionIds: ['retained', 'gpt'],
            collectionsError: new Error('读取失败'),
            productData: {
                product: {
                    collections: [{ id: 'retained', name: '已关联分类', slug: 'retained', filters: [] }],
                },
            },
        });
        await mountSummary();
        expect(host?.textContent).toContain('商品分类更新失败');
        expect(host?.textContent).toContain('已关联分类');
        expect(host?.textContent).toContain('GPT订阅');
        await click('选择二级分类：Claude订阅');
        expect(editorState.selectedCollectionIds).toEqual(['retained', 'gpt', 'claude']);
        const retry = [...host!.querySelectorAll('button')].find(button =>
            button.textContent?.includes('重试分类读取'),
        )!;
        await act(async () => retry.click());
        expect(editorState.refetchCollections).toHaveBeenCalledOnce();
    });

    it('explains automatic assignments without suggesting that manual selection overrides rules', async () => {
        Object.assign(editorState, {
            selectedCollectionIds: [],
            productData: {
                product: {
                    collections: [{ id: 'gpt', name: 'GPT订阅', slug: 'gpt-subscription', filters: [] }],
                },
            },
        });
        await mountSummary();
        const automatic = host!.querySelector<HTMLInputElement>('[aria-label="自动匹配二级分类：GPT订阅"]')!;
        expect(automatic.checked).toBe(true);
        expect(automatic.disabled).toBe(true);
        expect(host?.textContent).toContain('已选 1 项');
        expect(host?.textContent).toContain('其中 1 项自动匹配');
        expect(host?.textContent).toContain('自动匹配');
        expect(host?.textContent).toContain('需在分类规则中调整');
        expect(document.getElementById(automatic.getAttribute('aria-describedby')!)).not.toBeNull();
        await act(async () => automatic.click());
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        expect(editorState.selectedCollectionIds).toEqual([]);
        await click('选择二级分类：Claude订阅');
        expect(editorState.selectedCollectionIds).toEqual(['claude']);
        expect(host?.textContent).toContain('已选 2 项');
    });

    it('disables choices while a product save is in progress', async () => {
        editorState.saving = true;
        await mountSummary();
        for (const input of host!.querySelectorAll<HTMLInputElement>('input'))
            expect(input.disabled).toBe(true);
        await click('选择二级分类：Claude订阅');
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
    });

    it('distinguishes first loading, empty categories and an empty search', async () => {
        Object.assign(editorState, { collectionsLoading: true, collectionsData: undefined });
        await mountSummary();
        expect(host?.textContent).toContain('正在读取商品分类');
        Object.assign(editorState, {
            collectionsLoading: false,
            collectionsData: { collections: { items: [], totalItems: 0 } },
        });
        await renderSummary();
        expect(host?.textContent).toContain('当前店铺暂无商品分类');
        Object.assign(editorState, {
            collectionsData: originalCollections,
            collectionSearch: '找不到的分类',
        });
        await renderSummary();
        expect(host?.textContent).toContain('未找到匹配的商品分类');
        expect(editorState.selectedCollectionIds).toEqual(['gpt']);
    });
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}

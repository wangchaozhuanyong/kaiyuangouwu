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

describe('ProductCategorySummary draft dialog', () => {
    let root: Root | undefined;
    let host: HTMLDivElement | undefined;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = undefined;
        host?.remove();
        host = undefined;
        editorState.selectedCollectionIds = ['gpt'];
        editorState.collectionSearch = '';
        editorState.collectionsLoading = false;
        editorState.collectionsError = null;
        editorState.saving = false;
        vi.clearAllMocks();
    });

    async function mountSummary() {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                <FeatureHelpProvider>
                    <ProductCategorySummary />
                </FeatureHelpProvider>,
            );
        });
        const trigger = document.querySelector<HTMLButtonElement>('[aria-label="修改商品分类"]')!;
        trigger.focus();
        await act(async () => trigger.click());
        return trigger;
    }

    async function click(label: string) {
        const target = Array.from(document.querySelectorAll<HTMLElement>('button, input')).find(
            element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
        );
        expect(target, label).toBeTruthy();
        await act(async () => target!.click());
    }

    it('holds changes locally, discards cancellation and restores focus', async () => {
        const trigger = await mountSummary();
        await click('选择二级分类：Claude订阅');
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已选择 2 个分类');

        await click('取消');
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);

        await click('修改商品分类');
        expect(
            document.querySelector<HTMLInputElement>('[aria-label="选择二级分类：Claude订阅"]')?.checked,
        ).toBe(false);
        expect(
            document.querySelector<HTMLInputElement>('[aria-label="取消选择二级分类：GPT订阅"]')?.checked,
        ).toBe(true);
    });

    it('applies every selected level once, without treating confirmation as a product save', async () => {
        await mountSummary();
        await click('选择一级分类：订阅服务');
        await click('选择二级分类：Claude订阅');
        await click('确认选择');
        expect(editorState.setSelectedCollectionIds).toHaveBeenCalledExactlyOnceWith([
            'gpt',
            'subscriptions',
            'claude',
        ]);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('discards Escape changes and avoids marking an unchanged selection dirty', async () => {
        const trigger = await mountSummary();
        await click('取消选择二级分类：GPT订阅');
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
        await click('修改商品分类');
        await click('确认选择');
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
    });

    it('keeps search separate from product selection and preserves all choices', async () => {
        await mountSummary();
        const search = document.querySelector<HTMLInputElement>('[aria-label="搜索商品分类或专辑"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Claude');
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(editorState.setCollectionSearch).toHaveBeenCalledWith('Claude');
        expect(editorState.setSelectedCollectionIds).not.toHaveBeenCalled();
        await click('取消');
        expect(editorState.selectedCollectionIds).toEqual(['gpt']);
    });

    it('retains selected category names and automatic matching during lookup failure', async () => {
        const selected = { id: 'retained', name: '已关联分类', slug: 'retained', filters: [] };
        const originalProduct = editorState.productData;
        Object.assign(editorState, {
            selectedCollectionIds: ['retained'],
            collectionsError: new Error('读取失败'),
            productData: { product: { collections: [selected] } },
        });
        try {
            await mountSummary();
            const summary = host?.querySelector('[aria-label="商品分类摘要"]');
            expect(summary?.textContent).toContain('已关联分类');
            expect(summary?.textContent).toContain('自动匹配');
            expect(summary?.textContent).toContain('重试分类读取');
            expect(document.querySelector('[role="dialog"]')?.textContent).toContain('GPT订阅');
        } finally {
            editorState.productData = originalProduct;
        }
    });
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { FacetItem } from './product-editor-types';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';

const fixture = vi.hoisted(() => ({
    state: {} as Record<string, any>,
    toggle: vi.fn(),
    search: vi.fn(),
    page: vi.fn(),
    size: vi.fn(),
    retry: vi.fn(),
}));
vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => fixture.state }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const facet = (index: number): FacetItem => ({
    id: `f${index}`,
    name: `属性组${index}`,
    code: `facet-${index}`,
    values: [{ id: `v${index}`, code: `value-${index}`, name: `选项${index}` }],
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
    vi.clearAllMocks();
    fixture.state = {
        isCreateMode: true,
        selectedFacetValueIds: ['v4', 'outside-page'],
        toggleFacetValue: fixture.toggle,
        selectedCollectionIds: [],
        collectionsData: { collections: { items: [] } },
        collectionSearch: '',
        facetSearch: '',
        setFacetSearch: fixture.search,
        facetPage: 0,
        facetPageSize: 20,
        setFacetPage: fixture.page,
        setFacetPageSize: fixture.size,
        facetsData: {
            facets: {
                items: [
                    facet(1),
                    facet(2),
                    facet(3),
                    facet(4),
                    facet(5),
                    { ...facet(6), code: 'catalog-import-category-store-5', name: '导入分类标记' },
                ],
                totalItems: 42,
            },
        },
        facetsLoading: false,
        facetsError: undefined,
        refetchFacets: fixture.retry,
        saving: false,
    };
    fixture.toggle.mockImplementation(id => {
        const ids = fixture.state.selectedFacetValueIds as string[];
        fixture.state.selectedFacetValueIds = ids.includes(id)
            ? ids.filter(value => value !== id)
            : [...ids, id];
    });
    fixture.search.mockImplementation(value => {
        fixture.state.facetSearch = value;
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
const render = (readOnly = false) =>
    act(async () =>
        root.render(
            <FeatureHelpProvider>
                <fieldset disabled={readOnly}>
                    <ProductFacetsCollectionsTab section="facets" compact />
                </fieldset>
            </FeatureHelpProvider>,
        ),
    );
const input = (index: number) =>
    host.querySelector<HTMLInputElement>(`[aria-label="属性组${index}：选项${index}"]`)!;
const group = (index: number) =>
    [...host.querySelectorAll<HTMLDetailsElement>('details')].find(item =>
        item.querySelector(':scope > summary')?.textContent?.startsWith(`属性组${index}`),
    )!;

describe('compact product facet selection', () => {
    it('keeps common and selected groups open, folds less-used groups and moves technical codes into details', async () => {
        await render();
        expect(group(1).open).toBe(true);
        expect(group(4).open).toBe(true);
        expect(group(5).open).toBe(false);
        const imported = [...host.querySelectorAll('details')].find(item =>
            item.querySelector(':scope > summary')?.textContent?.includes('导入与技术标记'),
        )!;
        expect(imported.open).toBe(false);
        expect(host.textContent).toContain('catalog-import-category-store-5');
        expect(input(1).closest('details')?.querySelector('code')?.closest('details')?.open).toBe(false);
        expect(host.textContent).toContain('已选 2 项');
        expect(host.textContent).toContain('另有 1 个已选属性未在本页显示');
    });

    it('updates only the chosen facet value and retains choices from other pages', async () => {
        await render();
        await act(async () => input(1).click());
        await render();
        expect(fixture.toggle).toHaveBeenCalledExactlyOnceWith('v1');
        expect(fixture.state.selectedFacetValueIds).toEqual(['v4', 'outside-page', 'v1']);
        expect(input(1).checked).toBe(true);
        await act(async () => input(4).click());
        await render();
        expect(fixture.state.selectedFacetValueIds).toEqual(['outside-page', 'v1']);
    });

    it('uses shared search submission and existing page controls without changing selected values', async () => {
        await render();
        const search = host.querySelector<HTMLInputElement>('[aria-label="搜索商品属性"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                search,
                '属性组5',
            );
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await render();
        expect(fixture.search).toHaveBeenCalledWith('属性组5');
        expect(fixture.page).toHaveBeenCalledWith(0);
        expect(group(5).open).toBe(true);
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click());
        expect(fixture.page).toHaveBeenLastCalledWith(1);
        expect(fixture.state.selectedFacetValueIds).toEqual(['v4', 'outside-page']);
        expect(fixture.toggle).not.toHaveBeenCalled();
    });

    it('retains loaded choices and selection on a refresh failure and retries only the read', async () => {
        fixture.state.facetsError = new Error('更新失败');
        await render();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('属性标签更新失败');
        expect(input(4).checked).toBe(true);
        const retry = [...host.querySelectorAll('button')].find(
            button => button.textContent === '重试属性读取',
        )!;
        await act(async () => retry.click());
        expect(fixture.retry).toHaveBeenCalledOnce();
        expect(fixture.toggle).not.toHaveBeenCalled();
        expect(fixture.state.selectedFacetValueIds).toEqual(['v4', 'outside-page']);
    });

    it('inherits product write protection and disables interaction during a save', async () => {
        await render(true);
        expect(input(1).matches(':disabled')).toBe(true);
        await act(async () => input(1).click());
        expect(fixture.toggle).not.toHaveBeenCalled();
        fixture.state.saving = true;
        await render();
        expect(input(1).disabled).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(true);
        expect(host.querySelector<HTMLInputElement>('[aria-label="搜索商品属性"]')?.disabled).toBe(true);
    });

    it('distinguishes first loading, no attributes and empty search results', async () => {
        fixture.state.facetsData = undefined;
        fixture.state.facetsLoading = true;
        await render();
        expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取属性标签');
        fixture.state.facetsLoading = false;
        fixture.state.facetsData = { facets: { items: [], totalItems: 0 } };
        await render();
        expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无筛选属性');
        fixture.state.facetSearch = '不存在';
        await render();
        expect(host.querySelector('[role="status"]')?.textContent).toContain('未找到匹配的筛选属性');
        expect(fixture.state.selectedFacetValueIds).toEqual(['v4', 'outside-page']);
    });
});

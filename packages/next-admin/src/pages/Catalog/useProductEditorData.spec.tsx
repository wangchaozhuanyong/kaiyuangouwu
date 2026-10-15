// @vitest-environment jsdom
import { parse, type DocumentNode } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GET_ASSETS,
    GET_COLLECTIONS,
    GET_FACETS,
    GET_OPTION_GROUPS,
    GET_PRODUCT_DETAIL,
} from '../../graphql/catalog.graphql';
import { SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX } from './catalog-option-groups';
import { useProductEditorData } from './useProductEditorData';

const queries = vi.hoisted(() => vi.fn());
const categoryIndex = vi.hoisted(() => ({
    ids: [] as string[],
    ready: false,
    loading: false,
    error: undefined as unknown,
    retry: vi.fn(),
}));
vi.mock('@apollo/client/react', () => ({ useQuery: queries }));
vi.mock('../../hooks/use-asset-category-index', () => ({ useAssetCategoryIndex: () => categoryIndex }));

type Input = Parameters<typeof useProductEditorData>[0];

function Probe({
    sizes,
    productId,
    assetCategory,
}: {
    sizes: [number, number, number];
    productId?: string;
    assetCategory?: Input['assetCategory'];
}) {
    const result = useProductEditorData({
        productId,
        isCreateMode: !productId,
        productDetailDocument: productId ? GET_PRODUCT_DETAIL : parse('query EditorProduct { __typename }'),
        facetPage: 2,
        facetPageSize: sizes[0],
        deferredFacetSearch: '标签',
        assetPage: 1,
        assetPageSize: sizes[1],
        deferredAssetSearch: '图片',
        assetCategory,
        optionGroupPage: 3,
        optionGroupPageSize: sizes[2],
        deferredOptionGroupSearch: '',
        isAssetPickerOpen: true,
        setErrorMessage: vi.fn(),
    } satisfies Input);
    return (
        <div>
            <output data-assets={result.assetsData?.assets.totalItems}>
                {result.productData?.product?.channels.map(channel => channel.id).join(',')}
            </output>
            <button type="button" onClick={() => void result.refetchAssets({ refreshCategories: true })}>
                刷新素材与分类
            </button>
        </div>
    );
}

function optionsFor(document: DocumentNode) {
    return queries.mock.calls.find(([query]) => query === document)?.[1].variables.options;
}

describe('product editor pagination across the extracted data hook', () => {
    beforeEach(() => {
        queries.mockReset();
        queries.mockReturnValue({ loading: true, refetch: vi.fn(), fetchMore: vi.fn() });
        Object.assign(categoryIndex, { ids: [], ready: false, loading: false, error: undefined });
        categoryIndex.retry.mockReset();
    });

    it.each<[[number, number, number]]>([[[20, 50, 100]], [[100, 20, 50]]])(
        'uses independent page sizes %s without truncating the category tree',
        sizes => {
            renderToStaticMarkup(<Probe sizes={sizes} />);
            expect(optionsFor(GET_FACETS)).toMatchObject({ skip: 2 * sizes[0], take: sizes[0] });
            expect(optionsFor(GET_ASSETS)).toMatchObject({ skip: sizes[1], take: sizes[1] });
            expect(optionsFor(GET_OPTION_GROUPS)).toMatchObject({ skip: 3 * sizes[2], take: sizes[2] });
            expect(optionsFor(GET_OPTION_GROUPS)).toMatchObject({
                filter: { code: { notContains: SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX } },
            });
            expect(optionsFor(GET_COLLECTIONS)).toMatchObject({ skip: 0, take: 100, topLevelOnly: true });
        },
    );

    it('uses only the current store-scoped product channels', () => {
        queries.mockImplementation((query: DocumentNode) => ({
            loading: false,
            refetch: vi.fn(),
            ...(query === GET_PRODUCT_DETAIL
                ? {
                      data: {
                          product: { id: '27', channels: [{ id: '16', code: 'sim-a' }] },
                      },
                  }
                : {}),
        }));
        expect(renderToStaticMarkup(<Probe sizes={[20, 20, 20]} productId="27" />)).toContain('16');
        expect(queries.mock.calls.find(([query]) => query === GET_PRODUCT_DETAIL)?.[1].variables).toEqual({
            id: '27',
            assignmentId: '27',
        });
    });

    it('combines the full category index with server-side search and pagination', () => {
        Object.assign(categoryIndex, { ready: true, ids: ['21', '201'] });
        renderToStaticMarkup(<Probe sizes={[20, 20, 20]} assetCategory="PRODUCT" />);
        expect(optionsFor(GET_ASSETS)).toMatchObject({
            skip: 20,
            take: 20,
            filter: { type: { eq: 'IMAGE' }, name: { contains: '图片' }, id: { in: ['21', '201'] } },
        });
        expect(queries.mock.calls.find(([query]) => query === GET_ASSETS)?.[1].skip).toBe(false);
    });

    it('does not query an incomplete category or turn index failure into an empty library', () => {
        categoryIndex.error = new Error('Index unavailable');
        const html = renderToStaticMarkup(<Probe sizes={[20, 20, 20]} assetCategory="QUICK_LINK" />);
        expect(queries.mock.calls.find(([query]) => query === GET_ASSETS)?.[1].skip).toBe(true);
        expect(html).not.toContain('data-assets="0"');
    });

    it('returns an actual empty category without querying all images', () => {
        categoryIndex.ready = true;
        const html = renderToStaticMarkup(<Probe sizes={[20, 20, 20]} assetCategory="OTHER" />);
        expect(queries.mock.calls.find(([query]) => query === GET_ASSETS)?.[1].skip).toBe(true);
        expect(html).toContain('data-assets="0"');
    });

    it('refreshes cached classifications after uploading from the unfiltered picker', async () => {
        const refreshPage = vi.fn().mockResolvedValue({});
        queries.mockReturnValue({ loading: false, refetch: refreshPage, fetchMore: vi.fn() });
        categoryIndex.retry.mockResolvedValue({});
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
            true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => root.render(<Probe sizes={[20, 20, 20]} assetCategory="ALL" />));
            await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
            expect(categoryIndex.retry).toHaveBeenCalledOnce();
            expect(refreshPage).toHaveBeenCalledOnce();
        } finally {
            await act(async () => root.unmount());
            container.remove();
        }
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));

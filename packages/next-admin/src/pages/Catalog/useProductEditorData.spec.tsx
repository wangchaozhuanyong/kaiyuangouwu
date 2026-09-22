import { parse, type DocumentNode } from 'graphql';
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
vi.mock('@apollo/client/react', () => ({ useQuery: queries }));

type Input = Parameters<typeof useProductEditorData>[0];

function Probe({ sizes, productId }: { sizes: [number, number, number]; productId?: string }) {
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
        optionGroupPage: 3,
        optionGroupPageSize: sizes[2],
        deferredOptionGroupSearch: '',
        isAssetPickerOpen: true,
        setErrorMessage: vi.fn(),
    } satisfies Input);
    return <output>{result.productData?.product?.channels.map(channel => channel.id).join(',')}</output>;
}

function optionsFor(document: DocumentNode) {
    return queries.mock.calls.find(([query]) => query === document)?.[1].variables.options;
}

describe('product editor pagination across the extracted data hook', () => {
    beforeEach(() => {
        queries.mockReset();
        queries.mockReturnValue({ loading: true, refetch: vi.fn(), fetchMore: vi.fn() });
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
        });
    });
});

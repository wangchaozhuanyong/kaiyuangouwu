import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

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
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}

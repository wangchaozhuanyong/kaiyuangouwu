import { QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
    useNavigate,
    useRouterState,
} from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import { type ShopApi } from '../../src/api';
import { CategoryPage } from '../../src/pages/category-page';
import { createStorefrontQueryClient } from '../../src/query-client';
import { CategoryPageContext } from '../../src/storefront-page-contexts';
import { StorefrontPageFrame } from '../../src/storefront-page-frame';
import '../../src/storefront-styles';
import {
    type CollectionSummary,
    type MarketConfig,
    type Product,
    type StorefrontCatalogInput,
    type StorefrontContentBlock,
} from '../../src/types';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// Actual responsive category and public shell components, with an in-memory catalog only.
// No ShopApi instance is created, and no production order, account or network API is used.
const params = new URLSearchParams(location.search);
const en = params.get('language') === 'en';
const language = en ? 'en' : 'zh';
document.documentElement.lang = en ? 'en' : 'zh-CN';
applyStorefrontVisualPreset(
    document.documentElement,
    params.get('preset') === 'neo-minimalist' ? 'neo-minimalist' : 'classic',
);
const market: MarketConfig = {
    code: 'local-category-layout',
    currencyCode: 'CNY',
    countryCode: 'CN',
    defaultLanguageCode: en ? 'en' : 'zh_Hans',
    locale: en ? 'en-GB' : 'zh-CN',
    label: 'Synthetic catalog',
};
const collections: CollectionSummary[] = ['one', 'two', 'empty'].map((id, index) => ({
    id,
    name: en ? ['One row', 'Two rows', 'Empty category'][index] : ['一排商品', '两排商品', '空分类'][index],
    slug: id,
    description: '',
    position: index,
    parentId: 'root',
    featuredAsset: null,
}));
const products: Product[] = collections.flatMap(collection =>
    Array.from({ length: collection.id === 'one' ? 4 : collection.id === 'two' ? 8 : 0 }, (_, i) => {
        const id = `${collection.id}-${i}`;
        const name = en ? `Synthetic subscription ${i + 1}` : `合成订阅商品 ${i + 1}`;
        return {
            id,
            name,
            slug: id,
            createdAt: '2026-01-01T00:00:00.000Z',
            description: en ? 'Local visual acceptance data' : '本地界面验收数据',
            featuredAsset: null,
            assets: [],
            collections: [collection],
            variants: [
                {
                    id: `variant-${id}`,
                    name,
                    sku: `SYNTHETIC-${id}`,
                    priceWithTax: 3800 + i * 100,
                    currencyCode: 'CNY',
                    stockLevel: 'IN_STOCK',
                    saleableStockLevel: 100,
                    featuredAsset: null,
                    product: { id, name, featuredAsset: null },
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
                },
            ],
            customFields: {
                fulfillmentType: 'digital',
                refundPolicy: 'MERCHANT_REVIEW',
                manualDeliverySlaMinutes: 60,
            },
        };
    }),
);
const api = {
    catalog: (input: StorefrontCatalogInput) => {
        const items = products.filter(product => product.collections[0].id === input.collectionId);
        return Promise.resolve({ items, totalItems: items.length });
    },
} as ShopApi;
const blocks =
    params.get('extra') === '1'
        ? ([
              {
                  id: 'synthetic-plugins',
                  code: 'storefront-client-plugins',
                  type: 'CLIENT_PLUGINS',
                  enabled: true,
                  position: 0,
                  startsAt: null,
                  endsAt: null,
                  imageUrl: null,
                  backgroundColor: null,
                  textColor: null,
                  targetType: 'NONE',
                  targetValue: null,
                  settings: null,
                  title: '',
                  subtitle: '',
                  body: '',
                  ctaLabel: '',
                  items: [
                      {
                          id: 'synthetic-support',
                          enabled: true,
                          position: 0,
                          label: '',
                          description: '',
                          imageUrl: null,
                          targetType: 'NONE',
                          targetValue: null,
                          settings: {
                              pluginCode: 'category-support-entry',
                              placement: 'AFTER_HEADER',
                              categoryScope: 'ALL',
                          },
                      },
                  ],
              },
          ] as StorefrontContentBlock[])
        : [];
const client = createStorefrontQueryClient();
function Fixture() {
    const search = useRouterState({ select: state => state.location.search }) as Record<string, string>;
    const selected = search.collectionId ?? 'one';
    const navigate = useNavigate();
    return (
        <StorefrontPageFrame
            routeName="category"
            language={language}
            desktop={false}
            accessMode="LIVE"
            storefrontName={en ? 'Local layout acceptance' : '本地分类验收'}
            logoUrl={null}
            displayCurrencyCode="CNY"
        >
            <CategoryPageContext.Provider
                value={{
                    api,
                    products,
                    collections,
                    contentBlocks: blocks,
                    storefrontName: en ? 'Synthetic catalog' : '合成商品目录',
                    loading: false,
                    error: null,
                    market,
                    locale: market.locale,
                    language,
                    activeCollectionId: selected,
                    activeChildId: 'all',
                    sortMode: 'recommended',
                    fulfillmentFilter: 'all',
                    inStockOnly: false,
                    minimumPrice: '',
                    maximumPrice: '',
                    onCollectionChange: collectionId =>
                        void navigate({ to: '/category', search: { collectionId } } as never),
                    onChildChange: () => undefined,
                    onSortChange: () => undefined,
                    onFilterChange: () => undefined,
                    onNotify: () => undefined,
                    onRetry: () => undefined,
                }}
            >
                <CategoryPage />
            </CategoryPageContext.Provider>
        </StorefrontPageFrame>
    );
}
const rootRoute = createRootRoute({ component: Outlet });
const categoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/category',
    validateSearch: value => value,
    component: Fixture,
});
const router = createRouter({
    routeTree: rootRoute.addChildren([categoryRoute]),
    history: createMemoryHistory({
        initialEntries: [`/category?collectionId=${params.get('rows') === 'two' ? 'two' : 'one'}`],
    }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('The local catalog fixture root is missing');
const root = createRoot(rootElement);
root.render(
    <QueryClientProvider client={client}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
import.meta.hot?.dispose(() => root.unmount());

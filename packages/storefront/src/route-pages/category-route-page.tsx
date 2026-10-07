import '../commerce-styles';
import { useDesktopLayout } from '../desktop-layout';
import { CategoryPage } from '../pages/category-page';
import { DesktopCatalogPage } from '../pages/desktop-catalog-page';
import { CategoryPageContext } from '../storefront-page-contexts';
import { FulfillmentType } from '../types';

import { useRouteRuntime as useRuntime } from './shared';

export function CategoryRoutePage() {
    const runtime = useRuntime();
    const desktop = useDesktopLayout();
    if (desktop) return <DesktopCatalogPage />;
    return (
        <CategoryPageContext.Provider
            value={{
                api: runtime.api,
                contextResolved: runtime.storefrontContextResolved,
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                loading: runtime.loading,
                error: runtime.error,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                activeCollectionId: runtime.activeCollectionId,
                activeChildId: runtime.activeChildId,
                sortMode: runtime.sortMode,
                fulfillmentFilter: runtime.fulfillmentFilter,
                inStockOnly: runtime.inStockOnly,
                minimumPrice: runtime.minimumPrice,
                maximumPrice: runtime.maximumPrice,
                onCollectionChange: (collectionId: string, childId: string) =>
                    runtime.updateCategory({ collectionId, childId }),
                onChildChange: (childId: string) => runtime.updateCategory({ childId }),
                onSortChange: sort => runtime.updateCategory({ sort }),
                onFilterChange: (
                    fulfillment: 'all' | FulfillmentType,
                    inStockOnly: boolean,
                    minPrice: string,
                    maxPrice: string,
                ) =>
                    runtime.updateCategory({
                        fulfillment,
                        inStockOnly,
                        minPrice: minPrice || undefined,
                        maxPrice: maxPrice || undefined,
                    }),
                onNotify: () => runtime.navigate({ name: 'notifications' }),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <CategoryPage />
        </CategoryPageContext.Provider>
    );
}

export const preloadCategoryRoutePage = () => Promise.resolve();

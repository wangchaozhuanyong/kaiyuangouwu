import '../commerce-styles';
import { storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import { usePageRouteCommit } from '../page-readiness';
import { CategoryPage } from '../pages/category-page';
import { CategoryPageContext } from '../storefront-page-contexts';
import { FulfillmentType } from '../types';

import { useRouteRuntime as useRuntime } from './shared';

export function CategoryRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    return (
        <CategoryPageContext.Provider
            value={{
                api: runtime.api,
                contextResolved: runtime.storefrontContextResolved,
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                storefrontName: runtime.storefrontName,
                loading:
                    runtime.loading || storefrontQueryPresentation(runtime.collectionsQuery).initialLoading,
                error:
                    runtime.error || storefrontInitialQueryError(runtime.collectionsQuery, runtime.language),
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
                page: runtime.route.page,
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

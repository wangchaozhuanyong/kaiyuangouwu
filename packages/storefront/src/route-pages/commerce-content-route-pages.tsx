import { PublicCatalogMediaProvider, merchandisingMediaCatalogs } from '../public-catalog-media';
import { FlashSalePage, RecommendationPage } from '../storefront-ui/content-ui';
import { Product } from '../types';

import '../commerce-styles';
import '../styles/account-catalog-surfaces.css';
import { useRouteRuntime as useRuntime } from './shared';

export function FlashSaleRoutePage() {
    const runtime = useRuntime();
    return (
        <FlashSalePage
            sales={runtime.activeFlashSales}
            language={runtime.language}
            locale={runtime.locale}
            onBack={runtime.goBack}
            onProduct={(productId: string, variantId?: string) =>
                runtime.navigate({ name: 'product', id: productId, variantId })
            }
        />
    );
}

export function RecommendationsRoutePage() {
    const runtime = useRuntime();
    return (
        <PublicCatalogMediaProvider
            market={runtime.market}
            language={runtime.language}
            collections={runtime.collections}
            catalogs={merchandisingMediaCatalogs(
                runtime.catalogTakes,
                runtime.bestSellerProducts,
                runtime.recommendationProducts,
                false,
            )}
        >
            <RecommendationPage
                products={runtime.recommendationProducts}
                loading={runtime.recommendationsLoading}
                block={runtime.recommendationsBlock}
                market={runtime.market}
                locale={runtime.locale}
                language={runtime.language}
                onBack={runtime.goBack}
                onProduct={(product: Product) => runtime.navigate({ name: 'product', id: product.id })}
            />
        </PublicCatalogMediaProvider>
    );
}

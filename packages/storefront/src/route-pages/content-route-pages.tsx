import { lazy } from 'react';

import { FlashSalePage, RecommendationPage } from '../storefront-ui/content-ui';
import { Product, ProductVariant } from '../types';

import { RoutePageContext as PageContext, RouteGate, useRouteRuntime as useRuntime } from './shared';

const ReviewCenterPage = lazy(() =>
    import('../review-pages').then(module => ({ default: module.ReviewCenterPage })),
);
const SupportPage = lazy(() =>
    import('../pages/support-page').then(module => ({ default: module.SupportPage })),
);
const BusinessServicesPage = lazy(() =>
    import('../pages/business-services-page').then(module => ({ default: module.BusinessServicesPage })),
);
const AiImageStudioPage = lazy(() =>
    import('../pages/ai-image-studio-page').then(module => ({ default: module.AiImageStudioPage })),
);

export function ServicesRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
            value={{
                contentBlocks: runtime.contentBlocks,
                language: runtime.language,
                onNavigate: runtime.navigate,
            }}
        >
            <BusinessServicesPage />
        </PageContext>
    );
}

export function ImageStudioRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="image-studio">
            <AiImageStudioPage
                api={runtime.api}
                customer={runtime.customer}
                market={runtime.market}
                language={runtime.language}
                onBack={runtime.goBack}
                onSignIn={() => runtime.navigate({ name: 'login' })}
                onNotify={runtime.notify}
            />
        </RouteGate>
    );
}

export function FlashSaleRoutePage() {
    const runtime = useRuntime();
    return (
        <FlashSalePage
            sales={runtime.activeFlashSales}
            language={runtime.language}
            locale={runtime.locale}
            onBack={runtime.goBack}
            onProduct={(productId: string) => runtime.navigate({ name: 'product', id: productId })}
        />
    );
}

export function RecommendationsRoutePage() {
    const runtime = useRuntime();
    return (
        <RecommendationPage
            products={runtime.recommendationProducts}
            block={runtime.recommendationsBlock}
            market={runtime.market}
            locale={runtime.locale}
            language={runtime.language}
            addingVariantId={runtime.addingVariantId}
            onBack={runtime.goBack}
            onProduct={(product: Product) => runtime.navigate({ name: 'product', id: product.id })}
            onAdd={(variant: ProductVariant) => void runtime.addToCart(variant)}
        />
    );
}

export function ReviewsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="reviews">
            <ReviewCenterPage
                api={runtime.api}
                customer={runtime.customer}
                market={runtime.market}
                language={runtime.language}
                onBack={runtime.goBack}
                onProduct={(productId: string) => runtime.navigate({ name: 'product', id: productId })}
                onShop={() => runtime.navigate({ name: 'category' })}
                onSignIn={() => runtime.navigate({ name: 'login' })}
                onNotify={runtime.notify}
            />
        </RouteGate>
    );
}

export function SupportRoutePage() {
    const runtime = useRuntime();
    return (
        <PageContext
            value={{
                content: runtime.supportContent,
                products: runtime.products,
                language: runtime.language,
                onContentTarget: runtime.openContentTarget,
            }}
        >
            <SupportPage />
        </PageContext>
    );
}

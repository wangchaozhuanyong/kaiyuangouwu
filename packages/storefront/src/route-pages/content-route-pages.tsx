import { lazyRouteComponent } from '@tanstack/react-router';

import { FlashSalePage, RecommendationPage } from '../storefront-ui/content-ui';
import { Product } from '../types';

import {
    RoutePageContext as PageContext,
    registerRoutePreload,
    RouteGate,
    useRouteRuntime as useRuntime,
} from './shared';

const ReviewCenterPage = lazyRouteComponent(() => import('../review-pages'), 'ReviewCenterPage');
const SupportPage = lazyRouteComponent(() => import('../pages/support-page'), 'SupportPage');
const BusinessServicesPage = lazyRouteComponent(
    () => import('../pages/business-services-page'),
    'BusinessServicesPage',
);
const AiImageStudioPage = lazyRouteComponent(
    () => import('../pages/ai-image-studio-page'),
    'AiImageStudioPage',
);
const TwoFactorPage = lazyRouteComponent(
    () => import('../client-plugins/two-factor/two-factor-page'),
    'TwoFactorPage',
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
                displayCurrencyCode={runtime.displayCurrencyCode}
                language={runtime.language}
                onBack={runtime.goBack}
                onSignIn={() => runtime.navigate({ name: 'login' })}
                onNotify={runtime.notify}
            />
        </RouteGate>
    );
}

export function TwoFactorRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="two-factor">
            <TwoFactorPage
                customer={runtime.customer}
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
            onBack={runtime.goBack}
            onProduct={(product: Product) => runtime.navigate({ name: 'product', id: product.id })}
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

export const preloadServicesRoutePage = registerRoutePreload(ServicesRoutePage, BusinessServicesPage);
export const preloadImageStudioRoutePage = registerRoutePreload(ImageStudioRoutePage, AiImageStudioPage);
export const preloadTwoFactorRoutePage = registerRoutePreload(TwoFactorRoutePage, TwoFactorPage);
export const preloadReviewsRoutePage = registerRoutePreload(ReviewsRoutePage, ReviewCenterPage);
export const preloadSupportRoutePage = registerRoutePreload(SupportRoutePage, SupportPage);

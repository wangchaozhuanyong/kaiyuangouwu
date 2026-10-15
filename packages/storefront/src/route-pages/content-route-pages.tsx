import { lazyRouteComponent } from '@tanstack/react-router';

import { resolveQueryLoadState } from '../loading-state';
import { usePageRouteCommit } from '../page-readiness';
import { storefrontErrorMessage } from '../storefront-errors';
import { BusinessServicesPageContext, SupportPageContext } from '../storefront-page-contexts';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';

import { registerRoutePreload, RouteGate, useRouteRuntime as useRuntime } from './shared';

// Commerce-only content and its original stylesheet order belong to these two
// destinations. Services/support do not need to parse the home/product CSS.
export const FlashSaleRoutePage = lazyRouteComponent(
    () => import('./commerce-content-route-pages'),
    'FlashSaleRoutePage',
);
export const RecommendationsRoutePage = lazyRouteComponent(
    () => import('./commerce-content-route-pages'),
    'RecommendationsRoutePage',
);

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
    () => import('../client-plugins/two-factor/isolated-entry'),
    'CustomerTwoFactorEntry',
);
const MailQueryPage = lazyRouteComponent(
    () => import('../client-plugins/mail-query/mail-query-page'),
    'MailQueryPage',
);

export function ServicesRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    const contentLoadState = resolveQueryLoadState({
        hasData: runtime.contentQuery.data !== undefined,
        isLoading: runtime.contentQuery.isLoading,
        isPaused: runtime.contentQuery.isPaused,
        isError: runtime.contentQuery.isError,
    });
    if (contentLoadState !== 'ready') {
        return (
            <AsyncRouteStatePage
                routeName="services"
                state={contentLoadState}
                error={runtime.contentError}
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    }
    return (
        <BusinessServicesPageContext.Provider
            value={{
                contentBlocks: runtime.contentBlocks,
                language: runtime.language,
                storefrontName: runtime.storefrontName,
                logoUrl: runtime.logoUrl,
                marketLabel: runtime.market.label,
                displayCurrencyCode: runtime.displayCurrencyCode,
                availableCurrencyCodes: runtime.currencySelectorEnabled ? runtime.availableCurrencyCodes : [],
                currencyLoading: runtime.cartLoading,
                onToggleLanguage: runtime.toggleLanguage,
                onCurrencyChange: runtime.switchCurrency,
                onNotifications: () => runtime.navigate({ name: 'notifications' }),
                onNavigate: runtime.navigate,
                onContentTarget: runtime.openContentTarget,
            }}
        >
            <BusinessServicesPage />
        </BusinessServicesPageContext.Provider>
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
        <TwoFactorPage
            customer={runtime.customer}
            language={runtime.language}
            onBack={runtime.goBack}
            onSignIn={() => runtime.navigate({ name: 'login' })}
            onNotify={runtime.notify}
        />
    );
}

export function MailQueryRoutePage() {
    const runtime = useRuntime();
    return (
        <MailQueryPage
            key={JSON.stringify([runtime.market.code, runtime.customer?.id ?? null])}
            api={runtime.api}
            marketCode={runtime.market.code}
            customerId={runtime.customer?.id}
            brandingName={runtime.storefrontName}
            language={runtime.language}
            onBack={runtime.goBack}
            onNavigate={runtime.navigate}
            onNotify={runtime.notify}
        />
    );
}

export function ReviewsRoutePage() {
    const runtime = useRuntime();
    if (runtime.reviewSettingsStatus === 'disabled') return null;
    if (runtime.reviewSettingsStatus !== 'enabled') {
        return (
            <AsyncRouteStatePage
                routeName="reviews"
                state={runtime.reviewSettingsStatus === 'error' ? 'error' : 'loading'}
                error={
                    runtime.reviewSettingsStatus === 'error'
                        ? storefrontErrorMessage(runtime.reviewSettingsQuery.error, runtime.language)
                        : ''
                }
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.reviewSettingsQuery.refetch({ cancelRefetch: false })}
            />
        );
    }
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
    usePageRouteCommit();
    const runtime = useRuntime();
    return (
        <SupportPageContext.Provider
            value={{
                api: runtime.api,
                customer: runtime.customer,
                content: runtime.supportContent,
                language: runtime.language,
                orderCode: runtime.route.orderCode,
                focus: runtime.route.focus,
                onNotify: runtime.notify,
                onSignIn: () => runtime.navigate({ name: 'login' }),
            }}
        >
            <SupportPage />
        </SupportPageContext.Provider>
    );
}

export const preloadServicesRoutePage = registerRoutePreload(ServicesRoutePage, BusinessServicesPage);
export const preloadImageStudioRoutePage = registerRoutePreload(ImageStudioRoutePage, AiImageStudioPage);
export const preloadTwoFactorRoutePage = registerRoutePreload(TwoFactorRoutePage, TwoFactorPage);
export const preloadMailQueryRoutePage = registerRoutePreload(MailQueryRoutePage, MailQueryPage);
export const preloadReviewsRoutePage = registerRoutePreload(ReviewsRoutePage, ReviewCenterPage);
export const preloadSupportRoutePage = registerRoutePreload(SupportRoutePage, SupportPage);

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazyRouteComponent } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { importHomePage } from '../catalog-page-imports';
import { claimableCouponCampaigns } from '../coupon-campaign-eligibility';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { usePageReadiness, usePageRouteCommit } from '../page-readiness';
import { PublicCatalogMediaProvider, merchandisingMediaCatalogs } from '../public-catalog-media';
import { retryStorefrontRead, storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { HomePageContext } from '../storefront-page-contexts';
import { readInitialPublicPage } from '../storefront-page-data';
import { CollectionSummary, StorefrontCouponCampaign } from '../types';

import '../commerce-styles';
import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const HomePage = lazyRouteComponent(importHomePage, 'HomePage');

export function HomeRoutePage() {
    const client = useQueryClient();
    usePageRouteCommit();
    const runtime = useRuntime();
    const readMarket = storefrontQueryKeys.market(runtime.market);
    const readLanguage = languageCodeFor(runtime.language);
    const [initialPage] = useState(() =>
        document.getElementById('root')?.dataset.publicAdopted !== '1' ? readInitialPublicPage() : undefined,
    );
    const initialRenderTime = initialPage?.generatedAt;
    const couponScope = `${readMarket}:${readLanguage}`;
    const matchingSnapshot =
        initialPage &&
        `${initialPage.scope.channelCode}:${initialPage.scope.currencyCode}:${initialPage.scope.languageCode}` ===
            couponScope;
    const campaignsQuery = useQuery({
        queryKey: storefrontQueryKeys.couponCampaigns(readMarket, readLanguage, runtime.customer?.id ?? null),
        queryFn: ({ signal }) => runtime.api.activeCouponCampaigns(signal),
        enabled:
            runtime.customerLoadState === 'ready' &&
            runtime.contentBlocks.some(block => block.type === 'COUPONS' && block.enabled),
        initialData:
            runtime.customer || !matchingSnapshot
                ? undefined
                : (initialPage?.couponCampaigns as StorefrontCouponCampaign[] | undefined),
        initialDataUpdatedAt: initialPage?.generatedAt,
        // Recheck the prepared list on entry so an empty snapshot cannot suppress fresh offers.
        staleTime: 0,
    });
    const [couponVisit] = useState(() => {
        const coupons = initialPage
            ? matchingSnapshot && initialPage.couponAudience === 'anonymous'
                ? ((initialPage.couponCampaigns ?? []) as StorefrontCouponCampaign[])
                : []
            : runtime.customerLoadState === 'ready' &&
                runtime.couponCampaignsQuery.data !== undefined &&
                Date.now() - runtime.couponCampaignsQuery.dataUpdatedAt < 30_000
              ? runtime.activeCoupons
              : [];
        return {
            owner: initialPage ? null : (runtime.customer?.id ?? null),
            scope: couponScope,
            coupons,
            admitted: claimableCouponCampaigns(coupons, initialRenderTime).length > 0,
        };
    });
    const couponOwnerChanged =
        runtime.customerLoadState !== 'loading' && (runtime.customer?.id ?? null) !== couponVisit.owner;
    const [couponVisitCommitted, setCouponVisitCommitted] = useState(false);
    useEffect(() => setCouponVisitCommitted(true), []);
    // A late read still updates the scoped Query cache for the next visit. Only
    // an admitted first-frame section may follow updates during this visit.
    const visitCoupons =
        !couponVisit.admitted || couponOwnerChanged || couponVisit.scope !== couponScope
            ? []
            : couponVisitCommitted &&
                runtime.customerLoadState === 'ready' &&
                campaignsQuery.data !== undefined
              ? runtime.activeCoupons
              : couponVisit.coupons;
    const { language, configQuery, contentQuery, productsQuery } = runtime;
    usePageReadiness(
        contentQuery.isPending,
        'query',
        undefined,
        contentQuery.data === undefined && contentQuery.isError,
    );
    const contentError =
        contentQuery.data === undefined
            ? contentQuery.isPaused
                ? offlineLoadError(language)
                : contentQuery.error
                  ? storefrontErrorMessage(contentQuery.error, language)
                  : ''
            : '';
    const catalogError =
        productsQuery.data === undefined
            ? productsQuery.isPaused
                ? offlineLoadError(language)
                : productsQuery.error
                  ? storefrontErrorMessage(productsQuery.error, language)
                  : null
            : null;
    return (
        <HomePageContext.Provider
            value={{
                products: runtime.products,
                collections: runtime.collections,
                contentBlocks: runtime.contentBlocks,
                managedContentProducts: runtime.managedContentProducts,
                managedContentLoading:
                    runtime.managedContentLoading ||
                    (runtime.managedContentProductsQuery?.data === undefined &&
                        (runtime.managedContentProductsQuery?.isPaused ||
                            runtime.managedContentProductsQuery?.isError)),
                managedContentError:
                    runtime.managedContentProductsQuery?.data === undefined
                        ? runtime.managedContentProductsQuery?.isPaused
                            ? offlineLoadError(language)
                            : runtime.managedContentProductsQuery?.error
                              ? storefrontErrorMessage(runtime.managedContentProductsQuery.error, language)
                              : ''
                        : '',
                onManagedContentRetry: () =>
                    void runtime.managedContentProductsQuery?.refetch({ cancelRefetch: false }),
                managedContentResolved: runtime.managedContentResolved,
                responsiveIntro: true,
                initialRenderTime,
                heroAutoplayIntervalSeconds: runtime.heroAutoplayIntervalSeconds,
                configuredBlockTypes: runtime.configuredBlockTypes,
                coupons: visitCoupons,
                couponCampaignsLoading: false,
                couponCampaignsError: runtime.couponCampaignsError,
                flashSales: runtime.activeFlashSales,
                systemAnnouncements: runtime.systemAnnouncements,
                bestSellerProducts: runtime.bestSellerProducts,
                recommendationProducts: runtime.recommendationProducts,
                bestSellersLoading: runtime.bestSellersLoading,
                recommendationsLoading: runtime.recommendationsLoading,
                contentError,
                // The home hero depends on content, not the product catalog.
                loading: contentQuery.isPending && !contentQuery.isPaused,
                error:
                    configQuery.isError && configQuery.data === undefined
                        ? storefrontErrorMessage(configQuery.error, language)
                        : null,
                catalogLoading: productsQuery.isPending && !productsQuery.isPaused,
                catalogError,
                market: runtime.market,
                locale: runtime.locale,
                language: runtime.language,
                storefrontName: runtime.storefrontName,
                storefrontNameAliases: [
                    configQuery.data?.customFields.storefrontNameZh ?? '',
                    configQuery.data?.customFields.storefrontNameEn ?? '',
                ],
                storefrontDescription: runtime.storefrontDescription,
                storefrontTagline: runtime.storefrontTagline,
                logoUrl: runtime.logoUrl,
                logoOnLightUrl: runtime.logoOnLightUrl,
                couponLoading: runtime.cartLoading,
                onCategorySelect: (collection: CollectionSummary) => {
                    const childId = collection.children?.[0]?.id ?? collection.id;
                    runtime.updateCategory({ collectionId: collection.id, childId });
                },
                onToggleLanguage: runtime.toggleLanguage,
                availableCurrencyCodes: runtime.availableCurrencyCodes,
                currencySelectorEnabled: runtime.currencySelectorEnabled,
                displayCurrencyCode: runtime.displayCurrencyCode,
                currencyLoading: runtime.cartLoading,
                onCurrencyChange: runtime.switchCurrency,
                onNotifications: () => runtime.navigate({ name: 'notifications' }),
                onToast: runtime.notify,
                onClaimCoupon: runtime.claimCoupon,
                onCouponCampaignsRetry: () =>
                    void runtime.couponCampaignsQuery.refetch({ cancelRefetch: false }),
                onContentTarget: runtime.openContentTarget,
                onContentRetry: () =>
                    void retryStorefrontRead(client, [
                        ...storefrontQueryKeys.content(readMarket, readLanguage),
                        'public',
                    ]),
                onCatalogRetry: () =>
                    void retryStorefrontRead(
                        client,
                        storefrontQueryKeys.products(readMarket, readLanguage, 12),
                    ),
                onRetry: () => void runtime.refetchStorefront(),
            }}
        >
            <PublicCatalogMediaProvider
                market={runtime.market}
                language={runtime.language}
                collections={runtime.collections}
                catalogs={merchandisingMediaCatalogs(
                    runtime.catalogTakes,
                    runtime.bestSellerProducts,
                    runtime.recommendationProducts,
                    true,
                )}
            >
                <HomePage />
            </PublicCatalogMediaProvider>
        </HomePageContext.Provider>
    );
}

export const preloadHomeRoutePage = registerRoutePreload(HomeRoutePage, HomePage);

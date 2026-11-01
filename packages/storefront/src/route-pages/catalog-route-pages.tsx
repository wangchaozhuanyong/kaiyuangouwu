import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazyRouteComponent } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { importHomePage } from '../catalog-page-imports';
import { claimableCouponCampaigns } from '../coupon-campaign-eligibility';
import { languageCodeFor } from '../i18n';
import { storefrontInitialQueryError } from '../loading-state';
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
    const couponScope = `${readMarket}:${readLanguage}`;
    const [couponVisit] = useState(() => {
        const initialPage =
            document.getElementById('root')?.dataset.publicAdopted !== '1'
                ? readInitialPublicPage()
                : undefined;
        const prepared =
            initialPage?.couponAudience === 'anonymous' &&
            `${initialPage.scope.channelCode}:${initialPage.scope.currencyCode}:${initialPage.scope.languageCode}` ===
                couponScope
                ? (initialPage.couponCampaigns as StorefrontCouponCampaign[] | undefined)
                : undefined;
        const coupons = initialPage
            ? (prepared ?? [])
            : runtime.customerLoadState === 'ready' &&
                runtime.couponCampaignsQuery.data !== undefined &&
                Date.now() - runtime.couponCampaignsQuery.dataUpdatedAt < 30_000
              ? runtime.activeCoupons
              : [];
        return {
            owner: initialPage ? null : (runtime.customer?.id ?? null),
            scope: couponScope,
            coupons,
            seed: prepared,
            renderTime: initialPage?.generatedAt,
            visible: claimableCouponCampaigns(coupons, initialPage?.generatedAt).length > 0,
        };
    });
    const initialRenderTime = couponVisit.renderTime;
    const campaignsQuery = useQuery({
        queryKey: storefrontQueryKeys.couponCampaigns(readMarket, readLanguage, runtime.customer?.id ?? null),
        queryFn: ({ signal }) => runtime.api.activeCouponCampaigns(signal),
        enabled:
            runtime.customerLoadState === 'ready' &&
            runtime.contentBlocks.some(block => block.type === 'COUPONS' && block.enabled),
        initialData: !runtime.customer && couponVisit.scope === couponScope ? couponVisit.seed : undefined,
        // A server/device clock difference must not create indefinitely fresh reads.
        initialDataUpdatedAt: Math.min(initialRenderTime ?? 0, Date.now()),
        // Reuse prepared reads within the public snapshot's existing freshness window.
        staleTime: 30_000,
    });
    const [couponVisitCommitted, setCouponVisitCommitted] = useState(false);
    useEffect(() => setCouponVisitCommitted(true), []);
    // The first frame owns this visit's section presence. Identity bootstrap or a
    // pending/failed read must not remove prepared public content; a confirmed
    // different owner/scope must never inherit it. Current successful reads still
    // remove claimed/expired offers, including a confirmed empty result.
    const visitCoupons =
        (runtime.customer?.id ?? null) !== couponVisit.owner ||
        couponVisit.scope !== couponScope ||
        !couponVisit.visible
            ? []
            : !couponVisitCommitted || runtime.customerLoadState !== 'ready'
              ? couponVisit.coupons
              : (campaignsQuery.data ?? couponVisit.coupons);
    const { language, configQuery, contentQuery, productsQuery } = runtime;
    usePageReadiness(
        contentQuery.isPending,
        'query',
        undefined,
        contentQuery.data === undefined && contentQuery.isError,
    );
    const contentError = storefrontInitialQueryError(contentQuery, language);
    const catalogError = storefrontInitialQueryError(productsQuery, language) || null;
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
                managedContentError: runtime.managedContentProductsQuery
                    ? storefrontInitialQueryError(runtime.managedContentProductsQuery, language)
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

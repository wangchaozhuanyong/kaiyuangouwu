import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';

import { ShopApi } from '../api';
import { CartController } from '../cart/cart-controller';
import { useCart } from '../cart/use-cart';
import {
    documentLanguageFor,
    enabledMarkets,
    languageCodeFor,
    localeFor,
    marketForStorefrontConfig,
    uiCopy,
} from '../i18n';
import { configureMoneyDisplay } from '../money-display';
import {
    isStorefrontScopeAccessDenied,
    refreshStorefrontQueries,
    restorePublicQueryCache,
    storefrontQueryKeys,
    watchStorefrontScopeAccess,
} from '../query-client';
import { captureReferralAttribution } from '../referral-attribution';
import { isStorefrontClosedError } from '../storefront-access';
import { readInitialPublicPage, setPublicPageNavigationScope } from '../storefront-page-data';
import { storefrontPreviewParameters } from '../storefront-preview-parameters';
import { readStoredStrings, scopedStorageKey } from '../storefront-storage';
import {
    DEFAULT_STOREFRONT_NAMES,
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
    normalizeStorefrontName,
    readStoredCurrency,
    readStoredLanguage,
    readStoredSettlementCurrency,
    writeManualLanguage,
} from '../storefront-utils';
import { MarketConfig, StorefrontConfig, StorefrontLanguage, StorefrontLegalIdentity } from '../types';
import { useStorefrontVisualPreset } from '../use-storefront-visual-preset';

import { useStorefrontBrandColors } from './useStorefrontDocument';
import { useStorefrontPublicData } from './useStorefrontPublicData';

function previewLanguage(fallback: StorefrontLanguage): StorefrontLanguage {
    if (typeof window === 'undefined') return fallback;
    const parameters = storefrontPreviewParameters();
    if (parameters.get('storefrontPreviewEmbedded') !== '1') return fallback;
    return parameters.get('storefrontPreviewLanguage') === 'en' ? 'en' : 'zh';
}

export function useStorefrontBootstrap() {
    const queryClient = useQueryClient();
    const [initialPage] = useState(readInitialPublicPage);
    const initializedPreferenceScope = useRef('');
    const restoredCacheScopes = useRef(new Set<string>());

    const [{ market, language }, setStorefrontContext] = useState<{
        market: MarketConfig;
        language: StorefrontLanguage;
    }>(() => {
        const initialMarket = initialPage ? marketForStorefrontConfig(initialPage.config) : enabledMarkets[0];
        const currencyCode = readStoredSettlementCurrency(initialMarket);
        return {
            market: { ...initialMarket, currencyCode },
            language: previewLanguage(readStoredLanguage(initialMarket)),
        };
    });
    const [displayCurrencyCode, setDisplayCurrencyCode] = useState(() =>
        readStoredCurrency(enabledMarkets[0]),
    );
    const [storefrontContextResolved, setStorefrontContextResolved] = useState(Boolean(initialPage));
    const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [storefrontNames, setStorefrontNames] =
        useState<Record<StorefrontLanguage, string>>(DEFAULT_STOREFRONT_NAMES);
    const [storefrontCode, setStorefrontCode] = useState('');
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [logoOnLightUrl, setLogoOnLightUrl] = useState<string | null>(null);
    const [logoOnDarkUrl, setLogoOnDarkUrl] = useState<string | null>(null);
    const [storefrontDescription, setStorefrontDescription] = useState('');
    const [storefrontTagline, setStorefrontTagline] = useState('');
    const [availableCountries, setAvailableCountries] = useState<StorefrontConfig['availableCountries']>([]);
    const [availableProvinces, setAvailableProvinces] = useState<
        NonNullable<StorefrontConfig['availableProvinces']>
    >([]);
    const [availableCurrencyCodes, setAvailableCurrencyCodes] = useState<string[]>([]);
    const [currencySelectorEnabled, setCurrencySelectorEnabled] = useState(false);

    const locale = localeFor(language, market);
    const text = uiCopy[language];
    const isZh = language === 'zh';
    const storefrontName = storefrontNames[language];
    const vendureLanguageCode = languageCodeFor(language);
    const marketCode = storefrontQueryKeys.market(market);
    const subscribeAccess = useCallback(
        (notify: () => void) => watchStorefrontScopeAccess(queryClient, notify),
        [queryClient],
    );
    const readAccessDenied = useCallback(
        () => isStorefrontScopeAccessDenied(queryClient, { marketCode, languageCode: vendureLanguageCode }),
        [queryClient, marketCode, vendureLanguageCode],
    );
    const accessDenied = useSyncExternalStore(subscribeAccess, readAccessDenied, readAccessDenied);
    const cartController = useMemo(
        () => new CartController(`${market.code}:${market.currencyCode}`),
        [market.code, market.currencyCode],
    );
    const cartState = useCart(cartController);
    const api = useMemo(() => {
        const client = new ShopApi(market, vendureLanguageCode);
        client.enableCartCommands(cartController);
        return client;
    }, [market, vendureLanguageCode, cartController]);
    useEffect(() => () => cartController.reset(false), [cartController]);

    useEffect(() => {
        try {
            captureReferralAttribution();
        } catch {
            // Private browsing can disable localStorage; registration remains usable.
        }
    }, []);

    const accountQuery = useQuery({
        queryKey: storefrontQueryKeys.customer(storefrontQueryKeys.market(market), vendureLanguageCode),
        queryFn: ({ signal }) => api.activeCustomer(signal),
        enabled: storefrontContextResolved && !accessDenied,
        staleTime: 0,
    });
    const customerAuthenticated = Boolean(accountQuery.data);
    const queryContext = {
        api,
        market,
        language,
        vendureLanguageCode,
        storefrontContextResolved: storefrontContextResolved && !accessDenied,
        customerAuthenticated,
    };
    const visualConfig = useStorefrontVisualPreset(
        api,
        market,
        vendureLanguageCode,
        storefrontContextResolved && !accessDenied,
    );

    const publicData = useStorefrontPublicData(queryContext);
    const { configQuery } = publicData;
    const storefrontUnavailable =
        accessDenied ||
        configQuery.data?.accessMode === 'CLOSED' ||
        isStorefrontClosedError(configQuery.error, true);
    useEffect(() => {
        if (!storefrontUnavailable) return;
        setStorefrontContextResolved(false);
        setPublicPageNavigationScope(undefined);
    }, [storefrontUnavailable]);

    const legalIdentity = useMemo<StorefrontLegalIdentity>(
        () => ({
            legalEntityName: configQuery.data?.legalEntityName?.trim() || null,
            legalRegistrationCountry: configQuery.data?.legalRegistrationCountry?.trim() || null,
            legalRegistrationNumber: configQuery.data?.legalRegistrationNumber?.trim() || null,
            legalContactAddress: configQuery.data?.legalContactAddress?.trim() || null,
            supportEmail: configQuery.data?.supportEmail?.trim() || null,
            privacyEmail: configQuery.data?.privacyEmail?.trim() || null,
        }),
        [configQuery.data],
    );
    configureMoneyDisplay({
        displayCurrencyCode,
        cnyPerUsdtRate: configQuery.data?.currencyConfiguration?.cnyPerUsdtRate ?? null,
        myrPerUsdtRate: configQuery.data?.currencyConfiguration?.myrPerUsdtRate ?? null,
        usdtMarkupPercent: configQuery.data?.currencyConfiguration?.usdtMarkupPercent ?? 0,
    });

    useEffect(() => {
        const config = configQuery.data;
        if (!config || storefrontUnavailable) return;
        const nextStorefrontCode = config.code;
        const configuredMarket = marketForStorefrontConfig(config);
        const currencyConfiguration = config.currencyConfiguration;
        const settlementCurrencyCodes = currencyConfiguration?.availableCurrencyCodes.length
            ? currencyConfiguration.availableCurrencyCodes
            : [configuredMarket.currencyCode];
        const nextAvailableCurrencyCodes = [
            ...settlementCurrencyCodes,
            ...(currencyConfiguration?.usdtDisplayEnabled &&
            currencyConfiguration.usdtRateAvailable &&
            currencyConfiguration.usdtPaymentConfigured
                ? ['USDT']
                : []),
        ];
        const selectedDisplayCurrency = readStoredCurrency(configuredMarket, nextAvailableCurrencyCodes);
        const selectedSettlementCurrency =
            selectedDisplayCurrency === 'USDT'
                ? readStoredSettlementCurrency(configuredMarket, settlementCurrencyCodes)
                : selectedDisplayCurrency;
        const nextMarket = { ...configuredMarket, currencyCode: selectedSettlementCurrency };
        setAvailableCountries(config.availableCountries);
        setAvailableProvinces(config.availableProvinces ?? []);
        setAvailableCurrencyCodes(nextAvailableCurrencyCodes);
        setCurrencySelectorEnabled(currencyConfiguration?.selectorEnabled === true);
        setDisplayCurrencyCode(selectedDisplayCurrency);
        if (
            nextMarket.code !== market.code ||
            nextMarket.defaultLanguageCode !== market.defaultLanguageCode ||
            nextMarket.currencyCode !== market.currencyCode ||
            nextMarket.countryCode !== market.countryCode
        ) {
            const nextLanguage = previewLanguage(readStoredLanguage(nextMarket));
            if (
                nextLanguage === language &&
                !isStorefrontScopeAccessDenied(queryClient, {
                    marketCode: storefrontQueryKeys.market(nextMarket),
                    languageCode: vendureLanguageCode,
                })
            ) {
                const nextConfigKey = [
                    ...storefrontQueryKeys.config(
                        storefrontQueryKeys.market(nextMarket),
                        vendureLanguageCode,
                    ),
                    'public',
                ];
                const nextConfigState = queryClient.getQueryState(nextConfigKey);
                // Copy the response age as well as its data, and preserve a newer destination value.
                if (!nextConfigState?.data || nextConfigState.dataUpdatedAt < configQuery.dataUpdatedAt) {
                    queryClient.setQueryData(nextConfigKey, config, {
                        updatedAt: configQuery.dataUpdatedAt,
                    });
                }
            }
            setStorefrontContextResolved(false);
            setStorefrontContext({
                market: nextMarket,
                language: nextLanguage,
            });
            return;
        }
        const cacheScope = `${marketCode}:${vendureLanguageCode}`;
        if (
            config.accessMode === 'LIVE' &&
            !restoredCacheScopes.current.has(cacheScope) &&
            storefrontPreviewParameters().get('storefrontPreviewEmbedded') !== '1'
        ) {
            restoredCacheScopes.current.add(cacheScope);
            restorePublicQueryCache(queryClient);
        }
        setStorefrontContextResolved(true);
        setStorefrontCode(nextStorefrontCode);
        const preferenceScope = `${nextStorefrontCode}:${customerAuthenticated}`;
        if (initializedPreferenceScope.current !== preferenceScope) {
            initializedPreferenceScope.current = preferenceScope;
            setFavoriteProductIds(
                readStoredStrings(
                    scopedStorageKey(FAVORITE_PRODUCT_STORAGE_KEY, nextStorefrontCode),
                    FAVORITE_PRODUCT_LIMIT,
                ),
            );
            setRecentProductIds(
                readStoredStrings(
                    scopedStorageKey(RECENT_PRODUCT_STORAGE_KEY, nextStorefrontCode),
                    RECENT_PRODUCT_LIMIT,
                ),
            );
        }
        setStorefrontNames({
            zh: normalizeStorefrontName(config.customFields.storefrontNameZh, DEFAULT_STOREFRONT_NAMES.zh),
            en: normalizeStorefrontName(config.customFields.storefrontNameEn, DEFAULT_STOREFRONT_NAMES.en),
        });
        setLogoUrl(config.logoUrl ?? null);
        setLogoOnLightUrl(config.logoOnLightUrl ?? null);
        setLogoOnDarkUrl(config.logoOnDarkUrl ?? null);
        setStorefrontDescription(config.description?.trim() ?? '');
        setStorefrontTagline(config.tagline?.trim() ?? '');
    }, [
        customerAuthenticated,
        configQuery.data,
        configQuery.dataUpdatedAt,
        storefrontUnavailable,
        language,
        market,
        queryClient,
        vendureLanguageCode,
        marketCode,
        storefrontUnavailable,
    ]);

    useStorefrontBrandColors(configQuery.data, visualConfig.presetId, {
        ready: Boolean((configQuery.data && visualConfig.ready) || configQuery.isError),
        cache: visualConfig.cache,
    });
    useLayoutEffect(() => {
        // React Query pauses requests offline; keep the existing offline/retry UI visible.
        if (configQuery.isPaused) document.documentElement.removeAttribute('data-storefront-theme-pending');
    }, [configQuery.isPaused]);

    const refetchStorefront = useCallback(
        () =>
            refreshStorefrontQueries(queryClient, {
                marketCode: storefrontQueryKeys.market(market),
                languageCode: vendureLanguageCode,
            }),
        [market.code, market.currencyCode, queryClient, vendureLanguageCode],
    );

    useEffect(() => {
        if (!storefrontContextResolved || storefrontUnavailable) {
            setPublicPageNavigationScope(undefined);
            return;
        }
        setPublicPageNavigationScope({
            channelCode: market.code,
            currencyCode: market.currencyCode,
            languageCode: vendureLanguageCode,
        });
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `storefront_public_language=${vendureLanguageCode}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
        const allowed = configQuery.data?.currencyConfiguration?.availableCurrencyCodes ?? [
            market.currencyCode,
        ];
        if (/^[A-Z]{3}$/u.test(market.currencyCode) && allowed.includes(market.currencyCode))
            document.cookie = `storefront_public_currency=${market.currencyCode}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
        return () => setPublicPageNavigationScope(undefined);
    }, [
        storefrontContextResolved,
        storefrontUnavailable,
        vendureLanguageCode,
        market.code,
        market.currencyCode,
        configQuery.data,
    ]);

    useEffect(() => {
        document.documentElement.lang = documentLanguageFor(language);
        document.documentElement.setAttribute('translate', 'yes');
    }, [language]);

    const toggleLanguage = () =>
        setStorefrontContext(currentContext => {
            const nextLanguage = currentContext.language === 'zh' ? 'en' : 'zh';
            writeManualLanguage(currentContext.market.code, nextLanguage);
            return { ...currentContext, language: nextLanguage };
        });

    return {
        ...publicData,
        storefrontUnavailable,
        storefrontAccessMode: configQuery.data?.accessMode,
        market,
        language,
        setStorefrontContext,
        displayCurrencyCode,
        setDisplayCurrencyCode,
        storefrontContextResolved: storefrontContextResolved && !storefrontUnavailable,
        favoriteProductIds,
        recentProductIds,
        setFavoriteProductIds,
        setRecentProductIds,
        storefrontCode,
        logoUrl,
        logoOnLightUrl,
        logoOnDarkUrl,
        storefrontDescription,
        storefrontTagline,
        availableCountries,
        availableProvinces,
        availableCurrencyCodes,
        currencySelectorEnabled,
        locale,
        text,
        isZh,
        storefrontName,
        vendureLanguageCode,
        cartController,
        cartState,
        api,
        queryContext,
        customerAuthenticated,
        legalIdentity,
        refetchStorefront,
        toggleLanguage,
    };
}

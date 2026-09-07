import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { PUBLIC_QUERY_STALE_TIME, publicQueryMeta, storefrontQueryKeys } from '../query-client';
import { captureReferralAttribution } from '../referral-attribution';
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
import {
    MarketConfig,
    Product,
    StorefrontConfig,
    StorefrontLanguage,
    StorefrontLegalIdentity,
} from '../types';
import { useStorefrontVisualPreset } from '../use-storefront-visual-preset';

import { useStorefrontBrandColors } from './useStorefrontDocument';
import { useStorefrontPublicData } from './useStorefrontPublicData';

export function useStorefrontBootstrap() {
    const queryClient = useQueryClient();

    const [{ market, language }, setStorefrontContext] = useState<{
        market: MarketConfig;
        language: StorefrontLanguage;
    }>(() => {
        const initialMarket = enabledMarkets[0];
        const currencyCode = readStoredSettlementCurrency(initialMarket);
        return {
            market: { ...initialMarket, currencyCode },
            language: readStoredLanguage(initialMarket),
        };
    });
    const [displayCurrencyCode, setDisplayCurrencyCode] = useState(() =>
        readStoredCurrency(enabledMarkets[0]),
    );
    const [storefrontContextResolved, setStorefrontContextResolved] = useState(false);
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

    const queryContext = { api, market, language, vendureLanguageCode, storefrontContextResolved };
    const visualConfig = useStorefrontVisualPreset(
        api,
        market,
        vendureLanguageCode,
        storefrontContextResolved,
    );

    const publicData = useStorefrontPublicData(queryContext);
    const { configQuery, productsQuery, collectionsQuery } = publicData;

    const legalIdentity = useMemo<StorefrontLegalIdentity>(
        () => ({
            legalEntityName: configQuery.data?.legalEntityName?.trim() || null,
            legalRegistrationCountry: configQuery.data?.legalRegistrationCountry?.trim() || null,
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

    const cacheProducts = useCallback(
        (items: Product[]) => {
            for (const product of items) {
                const queryKey = storefrontQueryKeys.product(
                    storefrontQueryKeys.market(market),
                    vendureLanguageCode,
                    product.id,
                );
                queryClient.setQueryData(queryKey, product);
                void queryClient.prefetchQuery({
                    queryKey,
                    queryFn: () => product,
                    staleTime: PUBLIC_QUERY_STALE_TIME,
                    meta: publicQueryMeta(),
                });
            }
        },
        [market.code, market.currencyCode, queryClient, vendureLanguageCode],
    );

    useEffect(() => {
        const config = configQuery.data;
        if (!config) return;
        const nextStorefrontCode = config.code;
        const configuredMarket = marketForStorefrontConfig(config, market);
        const currencyConfiguration = config.currencyConfiguration;
        const settlementCurrencyCodes = currencyConfiguration?.availableCurrencyCodes.length
            ? currencyConfiguration.availableCurrencyCodes
            : [configuredMarket.currencyCode];
        const nextAvailableCurrencyCodes = [
            ...settlementCurrencyCodes,
            ...(currencyConfiguration?.usdtDisplayEnabled && currencyConfiguration.usdtRateAvailable
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
            const nextLanguage = readStoredLanguage(nextMarket);
            if (nextLanguage === language) {
                const nextConfigKey = storefrontQueryKeys.config(
                    storefrontQueryKeys.market(nextMarket),
                    vendureLanguageCode,
                );
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
        setStorefrontContextResolved(true);
        setStorefrontCode(nextStorefrontCode);
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
        setStorefrontNames({
            zh: normalizeStorefrontName(config.customFields.storefrontNameZh, DEFAULT_STOREFRONT_NAMES.zh),
            en: normalizeStorefrontName(config.customFields.storefrontNameEn, DEFAULT_STOREFRONT_NAMES.en),
        });
        setLogoUrl(config.logoUrl ?? null);
        setLogoOnLightUrl(config.logoOnLightUrl ?? null);
        setLogoOnDarkUrl(config.logoOnDarkUrl ?? null);
        setStorefrontDescription(config.description?.trim() ?? '');
        setStorefrontTagline(config.tagline?.trim() ?? '');
    }, [configQuery.data, configQuery.dataUpdatedAt, language, market, queryClient, vendureLanguageCode]);

    useStorefrontBrandColors(configQuery.data, visualConfig.presetId);

    useEffect(() => {
        if (productsQuery.data) cacheProducts(productsQuery.data);
    }, [cacheProducts, productsQuery.data]);

    const refetchStorefront = useCallback(async () => {
        await Promise.all([productsQuery.refetch(), collectionsQuery.refetch(), configQuery.refetch()]);
    }, [collectionsQuery, configQuery, productsQuery]);

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
        market,
        language,
        setStorefrontContext,
        displayCurrencyCode,
        setDisplayCurrencyCode,
        storefrontContextResolved,
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
        legalIdentity,
        refetchStorefront,
        toggleLanguage,
    };
}

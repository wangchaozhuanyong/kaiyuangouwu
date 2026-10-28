import { useEffect, useLayoutEffect, useRef } from 'react';

import {
    publicLanguageFromUrl,
    publicLocalizedHref,
    publicPageRequestFromUrl,
    publicPageRequestKey,
    publicPageRouteHref,
} from '../../../storefront-content-plugin/src/shared/public-page-data';
import { type PublicSeoDocument } from '../../../storefront-content-plugin/src/shared/public-seo';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { type StorefrontVisualPresetId } from '../../../storefront-content-plugin/src/visual-presets';
import { productDescriptionText } from '../rich-text';
import { applyStorefrontIcons } from '../storefront-icons';
import { storefrontDocumentUrl } from '../storefront-preview-parameters';
import { type RouteName, type RouteState } from '../storefront-router';
import { cacheStorefrontTheme } from '../storefront-theme-cache';
import { setMetaContent, trimText } from '../storefront-utils';
import { type Product, type StorefrontConfig } from '../types';

import { type SecondaryMetadata } from './storefront-secondary-metadata';

export function useStorefrontBrandColors(
    config: StorefrontConfig | undefined,
    presetId: StorefrontVisualPresetId = 'classic',
    options: { ready: boolean; cache: boolean } = { ready: true, cache: false },
) {
    useLayoutEffect(() => {
        if (!options.ready) return;
        const root = document.documentElement;
        const palette = resolveStorefrontSemanticPalette(presetId, {
            backgroundColor: config?.brandBackgroundColor,
            primaryColor: config?.brandPrimaryColor,
            accentColor: config?.brandAccentColor,
            highlightColor: config?.brandHighlightColor,
        });
        const colors = {
            ...semanticPaletteCssVariables(palette),
            ...storefrontSkinCssVariables(presetId, palette),
        };
        const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        const previousColorScheme = root.style.getPropertyValue('color-scheme');
        const previousThemeColor = themeColorMeta?.content;
        const previousMetaColorScheme = colorSchemeMeta?.content;
        for (const [property, value] of Object.entries(colors)) {
            root.style.setProperty(property, value);
        }
        const colorScheme = presetId === 'neo-minimalist' ? 'dark' : 'light';
        root.style.setProperty('color-scheme', colorScheme);
        if (themeColorMeta) themeColorMeta.content = palette.page;
        if (colorSchemeMeta) colorSchemeMeta.content = colorScheme;
        root.removeAttribute('data-storefront-theme-pending');
        if (options.cache && config?.code)
            cacheStorefrontTheme(config.code, presetId, semanticPaletteCssVariables(palette));
        return () => {
            for (const property of Object.keys(colors)) root.style.removeProperty(property);
            if (previousColorScheme) root.style.setProperty('color-scheme', previousColorScheme);
            else root.style.removeProperty('color-scheme');
            if (themeColorMeta && previousThemeColor !== undefined)
                themeColorMeta.content = previousThemeColor;
            if (colorSchemeMeta && previousMetaColorScheme !== undefined) {
                colorSchemeMeta.content = previousMetaColorScheme;
            }
        };
    }, [config, presetId, options.ready, options.cache]);
}

export function useStorefrontMetadata({
    isZh,
    route,
    selectedProduct,
    storefrontDescription,
    storefrontName,
    logoUrl,
    brandingReady = true,
    brandingScopeKey,
    publicSeo,
    seoAccessMode,
}: {
    isZh: boolean;
    route: RouteState;
    selectedProduct: Product | null | undefined;
    storefrontDescription: string;
    storefrontName: string;
    logoUrl: string | null;
    brandingReady?: boolean;
    brandingScopeKey?: string;
    publicSeo?: PublicSeoDocument | null;
    seoAccessMode?: string;
}) {
    const iconScope = useRef(brandingScopeKey);
    useEffect(() => {
        const location = new URL(storefrontDocumentUrl());
        let request;
        try {
            request = publicPageRequestFromUrl(location.pathname + location.search);
        } catch {
            /* Invalid routes stay noindex. */
        }
        const explicitLanguage = publicLanguageFromUrl(location.pathname);
        let canonicalMatchesHost = false;
        try {
            canonicalMatchesHost = Boolean(publicSeo && new URL(publicSeo.canonical).host === location.host);
        } catch {
            /* Invalid metadata stays noindex. */
        }
        const validSeo =
            publicSeo?.schemaVersion === 1 &&
            publicSeo.published === true &&
            seoAccessMode === 'LIVE' &&
            publicSeo.host === location.host &&
            publicSeo.channelCode === brandingScopeKey &&
            explicitLanguage === publicSeo.languageCode &&
            publicSeo.languageCode === (isZh ? 'zh_Hans' : 'en') &&
            request &&
            publicSeo.requestKey === publicPageRequestKey(request) &&
            canonicalMatchesHost;
        document
            .querySelectorAll('link[rel="alternate"][hreflang], script[data-storefront-seo]')
            .forEach(node => node.remove());
        setMetaContent('meta[name="application-name"]', storefrontName);
        if (validSeo && publicSeo) {
            document.title = publicSeo.title;
            setMetaContent('meta[name="description"]', publicSeo.description);

            setMetaContent(
                'meta[name="robots"]',
                publicSeo.indexable === true ? publicSeo.robots : 'noindex, follow',
            );
            setCanonical(publicSeo.canonical);
            return deferMetadata({ publicSeo, storefrontName, isZh });
        }
        const routeLabels: Partial<Record<RouteName, string>> = {
            category: isZh ? '商品' : 'Shop',
            services: isZh ? '商业服务' : 'Business services',
            cart: isZh ? '购物车' : 'Cart',
            account: isZh ? '我的账户' : 'Account',
            search: isZh ? '搜索商品' : 'Search products',
            purchase: isZh ? '确认购买' : 'Confirm purchase',
            checkout: isZh ? '确认订单' : 'Review order',
            payment: isZh ? '选择支付方式' : 'Choose payment',
            'order-confirmation': isZh ? '订单已提交' : 'Order confirmed',
            orders: isZh ? '我的订单' : 'My orders',
            logistics: isZh ? '物流动态' : 'Delivery updates',
            'order-detail': isZh ? '订单详情' : 'Order details',
            addresses: isZh ? '地址管理' : 'Addresses',
            'account-security': isZh ? '账户与安全' : 'Account and security',
            favorites: isZh ? '我的收藏' : 'My favorites',
            history: isZh ? '浏览足迹' : 'Browsing history',
            notifications: isZh ? '消息通知' : 'Notifications',
            announcements: isZh ? '系统公告' : 'Announcements',
            coupons: isZh ? '优惠券' : 'Coupons',
            referral: isZh ? '邀请返利' : 'Referral rewards',
            support: isZh ? '客服中心' : 'Customer support',
            reviews: isZh ? '评价中心' : 'Reviews',
            'two-factor': isZh ? '2FA 动态码' : '2FA codes',
            'mail-query': isZh ? '邮件验证码查询' : 'Mail verification',
            login: isZh ? '登录' : 'Sign in',
            register: isZh ? '注册账户' : 'Create account',
            'verify-account': isZh ? '验证邮箱' : 'Verify email',
            'forgot-password': isZh ? '忘记密码' : 'Forgot password',
            'reset-password': isZh ? '重置密码' : 'Reset password',
            legal:
                route.id === 'terms'
                    ? isZh
                        ? '使用条款'
                        : 'Terms of use'
                    : isZh
                      ? '隐私政策'
                      : 'Privacy Policy',
            'not-found': isZh ? '页面未找到' : 'Page not found',
        };
        const defaultStorefrontDescription = isZh
            ? `在${storefrontName}浏览商品、管理购物车并在线完成订单。`
            : `Browse products, manage your cart and place orders with ${storefrontName}.`;
        const storeSummary = trimText(storefrontDescription || defaultStorefrontDescription, 150);
        const productTitle = route.name === 'product' ? selectedProduct?.name : undefined;
        const routeTitle = productTitle ?? routeLabels[route.name];
        const title = routeTitle
            ? `${routeTitle} · ${storefrontName}`
            : isZh
              ? `${storefrontName} · 在线商城`
              : `${storefrontName} · Online store`;
        const description =
            route.name === 'product' && selectedProduct?.description.trim()
                ? trimText(productDescriptionText(selectedProduct.description), 150)
                : storeSummary;
        const canonicalUrl = new URL(storefrontDocumentUrl());
        canonicalUrl.hash = '';
        canonicalUrl.search = '';
        if (request) {
            const href = publicPageRouteHref(request);
            const publicUrl = new URL(
                explicitLanguage ? publicLocalizedHref(href, explicitLanguage) : href,
                canonicalUrl.origin,
            );
            canonicalUrl.pathname = publicUrl.pathname;
            canonicalUrl.search = publicUrl.search;
        }

        document.title = title;
        setMetaContent('meta[name="description"]', description);
        setMetaContent('meta[name="robots"]', 'noindex, nofollow, noarchive');

        setCanonical(canonicalUrl.href);
        return deferMetadata({
            route,
            storefrontName,
            title,
            description,
            product: selectedProduct,
            logoUrl,
            isZh,
            canonical: canonicalUrl.href,
        });
    }, [
        isZh,
        route,
        selectedProduct,
        storefrontDescription,
        storefrontName,
        logoUrl,
        publicSeo,
        seoAccessMode,
        brandingScopeKey,
    ]);

    useLayoutEffect(() => {
        const scopeChanged = iconScope.current !== brandingScopeKey;
        iconScope.current = brandingScopeKey;
        if (!brandingReady) {
            if (scopeChanged) applyStorefrontIcons(null);
            return;
        }
        applyStorefrontIcons(logoUrl);
    }, [logoUrl, brandingReady, brandingScopeKey]);
}

/** A superseded route/store or changed browser URL cannot publish late metadata. */
function deferMetadata(input: SecondaryMetadata) {
    let active = true;
    const href = storefrontDocumentUrl();
    void import('./storefront-secondary-metadata')
        .then(module => {
            if (active && href === storefrontDocumentUrl()) module.applySecondaryMetadata(input, href);
        })
        .catch(() => undefined);
    return () => {
        active = false;
    };
}

function setCanonical(href: string) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.append(link);
    }
    link.href = href;
}

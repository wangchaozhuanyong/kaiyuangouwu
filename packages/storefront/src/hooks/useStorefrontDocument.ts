import { useEffect } from 'react';
import type { RouteName, RouteState } from '../storefront-router';
import type { Product, StorefrontConfig } from '../types';

import { productDescriptionText } from '../rich-text';
import { STOREFRONT_SOCIAL_IMAGE } from '../storefront-images';
import { productImage, setMetaContent, trimText } from '../storefront-utils';
import { cacheLogoUrl } from '../StorefrontErrorBoundary';

export function useStorefrontBrandColors(config: StorefrontConfig | undefined) {
    useEffect(() => {
        const root = document.documentElement;
        const colors = {
            '--brand-background': config?.brandBackgroundColor,
            '--brand-primary': config?.brandPrimaryColor,
            '--brand-accent': config?.brandAccentColor,
            '--brand-highlight': config?.brandHighlightColor,
            '--accent': config?.brandPrimaryColor,
            '--accent-hover': config?.brandHighlightColor,
            '--accent-ink': config?.brandPrimaryColor,
        } as const;
        for (const [property, value] of Object.entries(colors)) {
            if (value && /^#[0-9A-F]{6}$/iu.test(value)) root.style.setProperty(property, value);
            else root.style.removeProperty(property);
        }
        return () => {
            for (const property of Object.keys(colors)) root.style.removeProperty(property);
        };
    }, [config]);
}

export function useStorefrontMetadata({
    isZh,
    route,
    selectedProduct,
    storefrontDescription,
    storefrontName,
    logoUrl,
}: {
    isZh: boolean;
    route: RouteState;
    selectedProduct: Product | null | undefined;
    storefrontDescription: string;
    storefrontName: string;
    logoUrl: string | null;
}) {
    useEffect(() => {
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
            announcements: isZh ? '网站公告' : 'Website notices',
            history: isZh ? '浏览足迹' : 'Browsing history',
            notifications: isZh ? '消息通知' : 'Notifications',
            coupons: isZh ? '优惠券' : 'Coupons',
            referral: isZh ? '邀请返利' : 'Referral rewards',
            support: isZh ? '客服中心' : 'Customer support',
            reviews: isZh ? '评价中心' : 'Reviews',
            'two-factor': isZh ? '2FA 动态码' : '2FA codes',
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
        const imagePath =
            route.name === 'product' && selectedProduct
                ? (productImage(selectedProduct) ?? STOREFRONT_SOCIAL_IMAGE)
                : STOREFRONT_SOCIAL_IMAGE;
        const image = new URL(imagePath, window.location.origin).href;
        const imageAlt =
            route.name === 'product' && selectedProduct
                ? selectedProduct.name
                : isZh
                  ? `${storefrontName}精选商品`
                  : `Featured products from ${storefrontName}`;

        document.title = title;
        setMetaContent('meta[name="description"]', description);
        setMetaContent('meta[name="application-name"]', storefrontName);
        setMetaContent('meta[property="og:type"]', route.name === 'product' ? 'product' : 'website');
        setMetaContent('meta[property="og:site_name"]', storefrontName);
        setMetaContent('meta[property="og:title"]', title);
        setMetaContent('meta[property="og:description"]', description);
        setMetaContent('meta[property="og:image"]', image);
        setMetaContent('meta[property="og:image:alt"]', imageAlt);
        setMetaContent('meta[property="og:url"]', window.location.href);
        setMetaContent('meta[name="twitter:title"]', title);
        setMetaContent('meta[name="twitter:description"]', description);
        setMetaContent('meta[name="twitter:image"]', image);
        setMetaContent('meta[name="twitter:image:alt"]', imageAlt);
        let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.rel = 'canonical';
            document.head.append(canonical);
        }
        canonical.href = window.location.href;
    }, [isZh, route, selectedProduct, storefrontDescription, storefrontName]);

    useEffect(() => {
        cacheLogoUrl(logoUrl);
        if (!logoUrl) return;
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (link) {
            link.href = logoUrl;
            link.type = '';
        }
    }, [logoUrl]);
}

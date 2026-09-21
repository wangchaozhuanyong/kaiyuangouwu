import { useEffect, useMemo, useState } from 'react';

import {
    resolveStorefrontSemanticPalette,
    type StorefrontBrandPaletteInput,
} from '../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import {
    storefrontVisualPresets,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

import { ShopApi } from './api';
import { desktopPageFamilyByRoute } from './desktop-page-contract';
import { enabledMarkets, languageCodeFor } from './i18n';
import { productAvailability } from './product-availability';
import { routePath, storefrontRouteNames, type RouteName } from './storefront-router';

type PreviewScenario = 'normal' | 'empty' | 'loading' | 'error' | 'disabled' | 'dialog';
type PreviewViewport = 390 | 1023 | 1024 | 1440;
type PreviewAuth = 'guest' | 'authenticated';

const scenarios: Array<{ value: PreviewScenario; label: string }> = [
    { value: 'normal', label: '正常数据' },
    { value: 'empty', label: '空数据' },
    { value: 'loading', label: '加载中' },
    { value: 'error', label: '错误' },
    { value: 'disabled', label: '禁用' },
    { value: 'dialog', label: '弹窗' },
];

function previewRouteUrl(
    route: RouteName,
    preset: StorefrontVisualPresetId,
    scenario: PreviewScenario,
    auth: PreviewAuth,
    language: 'zh' | 'en',
    productId?: string,
): string {
    const parameters = new URLSearchParams({
        storefrontPreviewEmbedded: '1',
        storefrontPreviewPreset: preset,
        storefrontPreviewScenario: scenario,
        storefrontPreviewAuth: auth,
        storefrontPreviewLanguage: language,
    });
    if (route === 'product' && productId) parameters.set('id', productId);
    if (route === 'legal') parameters.set('id', 'privacy');
    return `${routePath(route)}?${parameters.toString()}`;
}

export function StorefrontDesignPreview() {
    const [preset, setPreset] = useState<StorefrontVisualPresetId>(() => {
        if (typeof window === 'undefined') return 'neo-minimalist';
        const candidate = new URLSearchParams(window.location.search).get('preset');
        return storefrontVisualPresets.find(option => option.id === candidate)?.id ?? 'neo-minimalist';
    });
    const [route, setRoute] = useState<RouteName>('home');
    const [scenario, setScenario] = useState<PreviewScenario>('normal');
    const [auth, setAuth] = useState<PreviewAuth>('guest');
    const [viewport, setViewport] = useState<PreviewViewport>(() => {
        if (typeof window === 'undefined') return 1440;
        const candidate = Number(new URLSearchParams(window.location.search).get('viewport'));
        return [390, 1023, 1024, 1440].includes(candidate) ? (candidate as PreviewViewport) : 1440;
    });
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [branding, setBranding] = useState<StorefrontBrandPaletteInput>();
    const [productPreview, setProductPreview] = useState<{
        status: 'loading' | 'ready' | 'empty' | 'error';
        id?: string;
    }>({ status: 'loading' });

    useEffect(() => {
        const controller = new AbortController();
        const api = new ShopApi(enabledMarkets[0], languageCodeFor(language));
        void api.storefrontConfig(controller.signal).then(
            config => {
                if (controller.signal.aborted) return;
                setBranding({
                    backgroundColor: config.brandBackgroundColor,
                    primaryColor: config.brandPrimaryColor,
                    accentColor: config.brandAccentColor,
                    highlightColor: config.brandHighlightColor,
                });
            },
            () => {
                if (!controller.signal.aborted) setBranding(undefined);
            },
        );
        return () => controller.abort();
    }, [language]);

    useEffect(() => {
        if (route !== 'product') return;
        const controller = new AbortController();
        setProductPreview({ status: 'loading' });
        const api = new ShopApi(enabledMarkets[0], languageCodeFor(language));
        void api.products(12, controller.signal).then(
            products => {
                if (controller.signal.aborted) return;
                const product =
                    products.find(item =>
                        item.variants.some(variant => !productAvailability(variant).soldOut),
                    ) ??
                    products.find(item => item.variants.length > 0) ??
                    products[0];
                setProductPreview(product ? { status: 'ready', id: product.id } : { status: 'empty' });
            },
            () => {
                if (!controller.signal.aborted) setProductPreview({ status: 'error' });
            },
        );
        return () => controller.abort();
    }, [route, language]);

    const source = useMemo(
        () => previewRouteUrl(route, preset, scenario, auth, language, productPreview.id),
        [auth, language, preset, productPreview.id, route, scenario],
    );
    const canvasColor = branding ? resolveStorefrontSemanticPalette(preset, branding).page : '#111827';

    useEffect(() => {
        document.title = '电脑端模板真实组件预览';
        let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
        if (!robots) {
            robots = document.createElement('meta');
            robots.name = 'robots';
            document.head.append(robots);
        }
        robots.content = 'noindex, nofollow, noarchive';
    }, []);

    return (
        <main className="storefront-design-preview">
            <header className="storefront-preview-toolbar">
                <div>
                    <strong>三套皮肤·统一模板预览</strong>
                    <span>
                        {desktopPageFamilyByRoute[route]} · {route} · 状态与会话为只读模拟
                    </span>
                </div>
                <label>
                    <span>皮肤</span>
                    <select
                        value={preset}
                        onChange={event => setPreset(event.target.value as StorefrontVisualPresetId)}
                    >
                        {storefrontVisualPresets.map(option => (
                            <option key={option.id} value={option.id}>
                                {option.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>路由（36）</span>
                    <select value={route} onChange={event => setRoute(event.target.value as RouteName)}>
                        {storefrontRouteNames.map(routeName => (
                            <option key={routeName} value={routeName}>
                                {routeName}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>状态</span>
                    <select
                        value={scenario}
                        onChange={event => setScenario(event.target.value as PreviewScenario)}
                    >
                        {scenarios.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>会话</span>
                    <select value={auth} onChange={event => setAuth(event.target.value as PreviewAuth)}>
                        <option value="guest">模拟未登录</option>
                        <option value="authenticated">模拟已登录</option>
                    </select>
                </label>
                <label>
                    <span>宽度</span>
                    <select
                        value={viewport}
                        onChange={event => setViewport(Number(event.target.value) as PreviewViewport)}
                    >
                        {[390, 1023, 1024, 1440].map(width => (
                            <option key={width} value={width}>
                                {width}px
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => setLanguage(current => (current === 'zh' ? 'en' : 'zh'))}
                >
                    {language === 'zh' ? 'EN' : '中文'}
                </button>
            </header>
            <section className="storefront-preview-stage" aria-label="真实客户端页面">
                {route === 'product' && productPreview.status !== 'ready' ? (
                    <p className="storefront-preview-feedback" role="status">
                        {productPreview.status === 'loading'
                            ? '正在读取当前店铺的可预览商品…'
                            : productPreview.status === 'empty'
                              ? '当前店铺暂无可预览商品，商品详情无法展示。'
                              : '商品读取失败，请检查店铺接口后重新选择此页面。'}
                    </p>
                ) : (
                    <iframe
                        key={source}
                        title={`${preset} ${route} ${viewport}`}
                        src={source}
                        style={{ width: viewport, backgroundColor: canvasColor }}
                    />
                )}
            </section>
        </main>
    );
}

import { useEffect, useRef, useState } from 'react';

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

import './styles/storefront-design-preview.css';

type PreviewScenario = 'normal' | 'empty' | 'loading' | 'error' | 'disabled' | 'dialog';
type PreviewViewport = 390 | 1023 | 1024 | 1440 | 1920 | 2560;
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
    session: string,
    productId?: string,
): string {
    const parameters = new URLSearchParams({
        storefrontPreviewEmbedded: '1',
        storefrontPreviewPreset: preset,
        storefrontPreviewScenario: scenario,
        storefrontPreviewAuth: auth,
        storefrontPreviewLanguage: language,
        storefrontPreviewSession: session,
    });
    if (route === 'product' && productId) parameters.set('id', productId);
    if (route === 'legal') parameters.set('id', 'privacy');
    return `${routePath(route)}?${parameters.toString()}`;
}

export function StorefrontDesignPreview() {
    const previewFrame = useRef<HTMLIFrameElement>(null);
    const requestedRoute = useRef<RouteName | null>(null);
    const [previewSession] = useState(
        () => `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    );
    const [preset, setPreset] = useState<StorefrontVisualPresetId>(() => {
        if (typeof window === 'undefined') return 'neo-minimalist';
        const candidate = new URLSearchParams(window.location.search).get('preset');
        return storefrontVisualPresets.find(option => option.id === candidate)?.id ?? 'neo-minimalist';
    });
    const [route, setRoute] = useState<RouteName>(() => {
        if (typeof window === 'undefined') return 'home';
        const candidate = new URLSearchParams(window.location.search).get('route');
        return storefrontRouteNames.includes(candidate as RouteName) ? (candidate as RouteName) : 'home';
    });
    const [scenario, setScenario] = useState<PreviewScenario>(() => {
        if (typeof window === 'undefined') return 'normal';
        const candidate = new URLSearchParams(window.location.search).get('scenario');
        return scenarios.some(option => option.value === candidate)
            ? (candidate as PreviewScenario)
            : 'normal';
    });
    const [auth, setAuth] = useState<PreviewAuth>(() => {
        if (typeof window === 'undefined') return 'guest';
        return new URLSearchParams(window.location.search).get('auth') === 'authenticated'
            ? 'authenticated'
            : 'guest';
    });
    const [viewport, setViewport] = useState<PreviewViewport>(() => {
        if (typeof window === 'undefined') return 1440;
        const candidate = Number(new URLSearchParams(window.location.search).get('viewport'));
        return [390, 1023, 1024, 1440, 1920, 2560].includes(candidate)
            ? (candidate as PreviewViewport)
            : 1440;
    });
    const [language, setLanguage] = useState<'zh' | 'en'>(() => {
        if (typeof window === 'undefined') return 'zh';
        return new URLSearchParams(window.location.search).get('language') === 'en' ? 'en' : 'zh';
    });
    const [frameReady, setFrameReady] = useState(false);
    const [branding, setBranding] = useState<StorefrontBrandPaletteInput>();
    const [productPreview, setProductPreview] = useState<{
        status: 'loading' | 'ready' | 'empty' | 'error';
        id?: string;
    }>({ status: 'loading' });
    const presetRef = useRef(preset);
    presetRef.current = preset;
    const frameSource = useRef(
        previewRouteUrl(route, preset, scenario, auth, language, previewSession, productPreview.id),
    );
    const [renderedSource, setRenderedSource] = useState(frameSource.current);

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
                if (product) {
                    frameSource.current = previewRouteUrl(
                        'product',
                        presetRef.current,
                        scenario,
                        auth,
                        language,
                        previewSession,
                        product.id,
                    );
                    setRenderedSource(frameSource.current);
                }
                setProductPreview(product ? { status: 'ready', id: product.id } : { status: 'empty' });
            },
            () => {
                if (controller.signal.aborted) return;
                frameSource.current = previewRouteUrl(
                    'product',
                    presetRef.current,
                    scenario,
                    auth,
                    language,
                    previewSession,
                    'product-1',
                );
                setRenderedSource(frameSource.current);
                setProductPreview({ status: 'ready', id: 'product-1' });
            },
        );
        return () => controller.abort();
    }, [auth, language, previewSession, route, scenario]);
    const canvasColor = resolveStorefrontSemanticPalette(preset, branding).page;

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

    useEffect(() => {
        const parameters = new URLSearchParams(window.location.search);
        parameters.set('preset', presetRef.current);
        parameters.set('route', route);
        parameters.set('scenario', scenario);
        parameters.set('auth', auth);
        parameters.set('viewport', String(viewport));
        parameters.set('language', language);
        const nextUrl = `${window.location.pathname}?${parameters.toString()}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
            window.history.replaceState(window.history.state, '', nextUrl);
        }
    }, [auth, language, preset, route, scenario, viewport]);

    useEffect(() => {
        const receivePreviewRoute = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.session !== previewSession) return;
            if (event.data?.type === 'storefront-preview-ready') {
                setFrameReady(true);
                return;
            }
            if (!frameReady) return;
            const nextRoute = event.data?.type === 'storefront-preview-route' ? event.data.route : null;
            if (!storefrontRouteNames.includes(nextRoute as RouteName)) return;
            if (requestedRoute.current && requestedRoute.current !== nextRoute) return;
            if (requestedRoute.current === nextRoute) requestedRoute.current = null;
            setRoute(current => {
                if (current === nextRoute) return current;
                frameSource.current = previewRouteUrl(
                    nextRoute as RouteName,
                    presetRef.current,
                    scenario,
                    auth,
                    language,
                    previewSession,
                    productPreview.id,
                );
                return nextRoute as RouteName;
            });
        };
        window.addEventListener('message', receivePreviewRoute);
        return () => window.removeEventListener('message', receivePreviewRoute);
    }, [auth, frameReady, language, previewSession, productPreview.id, scenario]);

    return (
        <main className="storefront-design-preview">
            <header className="storefront-preview-toolbar">
                <div>
                    <strong>三套皮肤·统一模板预览</strong>
                    <span>
                        {desktopPageFamilyByRoute[route]} · {route} ·
                        仅内嵌店铺页面会上线，预览控件与模拟状态不会上线
                    </span>
                </div>
                <label>
                    <span>皮肤</span>
                    <select
                        value={preset}
                        onChange={event => {
                            const nextPreset = event.target.value as StorefrontVisualPresetId;
                            frameSource.current = previewRouteUrl(
                                route,
                                nextPreset,
                                scenario,
                                auth,
                                language,
                                previewSession,
                                productPreview.id,
                            );
                            previewFrame.current?.setAttribute('src', frameSource.current);
                            setRenderedSource(frameSource.current);
                            setFrameReady(false);
                            setPreset(nextPreset);
                        }}
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
                    <select
                        value={route}
                        onChange={event => {
                            const nextRoute = event.target.value as RouteName;
                            requestedRoute.current = nextRoute;
                            const frame = previewFrame.current;
                            const nextSource = previewRouteUrl(
                                nextRoute,
                                presetRef.current,
                                scenario,
                                auth,
                                language,
                                previewSession,
                                productPreview.id,
                            );
                            frameSource.current = nextSource;
                            if (frameReady && frame && route !== 'product' && nextRoute !== 'product') {
                                frame.contentWindow?.postMessage(
                                    {
                                        type: 'storefront-preview-navigate',
                                        route: nextRoute,
                                        session: previewSession,
                                    },
                                    window.location.origin,
                                );
                            } else {
                                setFrameReady(false);
                                setRenderedSource(nextSource);
                            }
                            setRoute(nextRoute);
                        }}
                    >
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
                        onChange={event => {
                            const nextScenario = event.target.value as PreviewScenario;
                            frameSource.current = previewRouteUrl(
                                route,
                                presetRef.current,
                                nextScenario,
                                auth,
                                language,
                                previewSession,
                                productPreview.id,
                            );
                            setRenderedSource(frameSource.current);
                            setFrameReady(false);
                            setScenario(nextScenario);
                        }}
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
                    <select
                        value={auth}
                        onChange={event => {
                            const nextAuth = event.target.value as PreviewAuth;
                            frameSource.current = previewRouteUrl(
                                route,
                                presetRef.current,
                                scenario,
                                nextAuth,
                                language,
                                previewSession,
                                productPreview.id,
                            );
                            setRenderedSource(frameSource.current);
                            setFrameReady(false);
                            setAuth(nextAuth);
                        }}
                    >
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
                        {[390, 1023, 1024, 1440, 1920, 2560].map(width => (
                            <option key={width} value={width}>
                                {width}px
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => {
                        const nextLanguage = language === 'zh' ? 'en' : 'zh';
                        frameSource.current = previewRouteUrl(
                            route,
                            presetRef.current,
                            scenario,
                            auth,
                            nextLanguage,
                            previewSession,
                            productPreview.id,
                        );
                        setRenderedSource(frameSource.current);
                        setFrameReady(false);
                        setLanguage(nextLanguage);
                    }}
                >
                    {language === 'zh' ? 'EN' : '中文'}
                </button>
            </header>
            <section
                className="storefront-preview-stage"
                aria-label="真实客户端页面"
                style={{ backgroundColor: canvasColor }}
            >
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
                        ref={previewFrame}
                        title={`${preset} ${route} ${viewport}`}
                        src={renderedSource}
                        style={{ width: viewport, backgroundColor: canvasColor }}
                    />
                )}
            </section>
        </main>
    );
}

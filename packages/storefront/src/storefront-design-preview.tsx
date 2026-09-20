import { useEffect, useMemo, useState } from 'react';

import {
    storefrontVisualPresets,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

import { desktopPageFamilyByRoute } from './desktop-page-contract';
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
): string {
    const parameters = new URLSearchParams({
        storefrontPreviewEmbedded: '1',
        storefrontPreviewPreset: preset,
        storefrontPreviewScenario: scenario,
        storefrontPreviewAuth: auth,
        storefrontPreviewLanguage: language,
    });
    if (route === 'product') parameters.set('id', 'product-1');
    if (route === 'legal') parameters.set('id', 'privacy');
    return `${routePath(route)}?${parameters.toString()}`;
}

export function StorefrontDesignPreview() {
    const [preset, setPreset] = useState<StorefrontVisualPresetId>('neo-minimalist');
    const [route, setRoute] = useState<RouteName>('home');
    const [scenario, setScenario] = useState<PreviewScenario>('normal');
    const [auth, setAuth] = useState<PreviewAuth>('guest');
    const [viewport, setViewport] = useState<PreviewViewport>(1440);
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const source = useMemo(
        () => previewRouteUrl(route, preset, scenario, auth, language),
        [auth, language, preset, route, scenario],
    );

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
                        {desktopPageFamilyByRoute[route]} · {route}
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
                        <option value="guest">未登录</option>
                        <option value="authenticated">已登录</option>
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
                <iframe
                    key={source}
                    title={`${preset} ${route} ${viewport}`}
                    src={source}
                    style={{ width: viewport }}
                />
            </section>
        </main>
    );
}

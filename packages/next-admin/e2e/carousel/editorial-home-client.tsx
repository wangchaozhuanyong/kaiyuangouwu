// organize-imports-ignore -- Preserve the explicit React import required by this local Vite fixture.
import type { StorefrontContentBlock } from '../../src/graphql/storefront.graphql';
import React, { useLayoutEffect, useState } from 'react';

import { DesktopLayoutContext, useDesktopViewport } from '../../../storefront/src/desktop-layout';
import { HomePage, type HomePageProps } from '../../../storefront/src/pages/home-page';
import { HomePageContext } from '../../../storefront/src/storefront-page-contexts';
import commerceStyles from '../../../storefront/src/styles/commerce-surfaces.css?inline';
import desktopHomeStyles from '../../../storefront/src/styles/desktop-home.css?inline';
import desktopStyles from '../../../storefront/src/styles/desktop-layout.css?inline';
import presetStyles from '../../../storefront/src/styles/visual-presets.css?inline';
import clientStyles from '../../../storefront/src/styles.css?inline';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { normalizeStorefrontVisualPreset } from '../../../storefront-content-plugin/src/visual-presets';
import { decorationDraft } from '../../src/pages/Storefront/storefront-decoration-model';

/** Actual HomePage, synthetic local content, and action receipts without external navigation. */
export function EditorialHomeClient({ blocks }: { blocks: StorefrontContentBlock[] }) {
    const [language, setLanguage] = useState<'zh_Hans' | 'en'>('zh_Hans');
    const [preset, setPreset] = useState(normalizeStorefrontVisualPreset('classic'));
    const [length, setLength] = useState('saved');
    const [action, setAction] = useState('');
    const desktop = useDesktopViewport();
    const palette = resolveStorefrontSemanticPalette(preset);
    const variables = {
        ...semanticPaletteCssVariables(palette),
        ...storefrontSkinCssVariables(preset, palette),
    };
    const variableStyles = Object.entries(variables)
        .map(([key, value]) => `${key}:${value}`)
        .join(';');
    useLayoutEffect(() => {
        const previous = document.documentElement.dataset.storefrontPreset;
        document.documentElement.dataset.storefrontPreset = preset;
        return () => {
            if (previous === undefined) delete document.documentElement.dataset.storefrontPreset;
            else document.documentElement.dataset.storefrontPreset = previous;
        };
    }, [preset]);
    const contentBlocks = blocks
        .filter(block => block.enabled)
        .flatMap(block => {
            const converted = decorationDraft(block, language).block;
            if (!converted) return [];
            // Local artwork server is a fixture-only source, not a public Vendure Asset URL.
            converted.imageUrl = block.imageUrl || converted.imageUrl;
            if (length === 'long' && block.type === 'HERO') {
                converted.title =
                    language === 'en'
                        ? 'Explore editable AI subscriptions and coding tools for your next ambitious project'
                        : '为下一次创作与开发选择适合自己的人工智能模型、编程工具和实用服务';
                converted.body = (
                    language === 'en'
                        ? 'This longer sample checks the two-line introduction and the complete editable title. '
                        : '长文案示例用于验证标题完整换行、介绍仅显示两行，按钮与图片不会重叠。'
                ).repeat(5);
                converted.settings = { ...converted.settings, mobileHeroTranslations: [] };
            }
            return [converted];
        });
    const homepageValue: HomePageProps = {
        products: [],
        collections: [],
        contentBlocks,
        managedContentProducts: [],
        heroAutoplayIntervalSeconds: 12,
        configuredBlockTypes: ['HERO'],
        coupons: [],
        couponCampaignsLoading: false,
        couponCampaignsError: '',
        flashSales: [],
        systemAnnouncements: [],
        bestSellerProducts: [],
        recommendationProducts: [],
        contentError: '',
        loading: false,
        error: null,
        catalogLoading: false,
        catalogError: null,
        market: {
            code: 'my-malaysia',
            currencyCode: 'MYR',
            countryCode: 'MY',
            defaultLanguageCode: 'zh_Hans',
            locale: 'zh-CN',
            label: '本地示例',
        },
        locale: language === 'en' ? 'en-MY' : 'zh-CN',
        language: language === 'en' ? 'en' : 'zh',
        storefrontName: '轮播设计示例',
        storefrontDescription: '',
        storefrontTagline: '',
        logoUrl: null,
        logoOnLightUrl: null,
        couponLoading: false,
        availableCurrencyCodes: ['MYR'],
        currencySelectorEnabled: false,
        displayCurrencyCode: 'MYR',
        currencyLoading: false,
        onCategorySelect: () => undefined,
        onToggleLanguage: () => setLanguage(v => (v === 'en' ? 'zh_Hans' : 'en')),
        onCurrencyChange: () => undefined,
        onNotifications: () => undefined,
        onClaimCoupon: () => Promise.resolve(null),
        onCouponCampaignsRetry: () => undefined,
        onContentTarget: (type, target) => setAction(`示例点击：${type} / ${target}`),
        onContentRetry: () => undefined,
        onRetry: () => undefined,
    };
    return (
        <React.Fragment>
            <style>{`${commerceStyles}\n${clientStyles}\n${desktopStyles}\n${presetStyles}\n${desktopHomeStyles}\n:root{${variableStyles}}`}</style>
            <div
                className="type-body"
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    background: 'var(--surface)',
                    color: 'var(--text)',
                }}
                data-editorial-carousel-controls
            >
                <strong>首页轮播本地验收 · 示例数据</strong>
                <label>
                    语言{' '}
                    <select
                        aria-label="轮播验收语言"
                        value={language}
                        onChange={e => setLanguage(e.target.value as 'zh_Hans' | 'en')}
                    >
                        <option value="zh_Hans">中文</option>
                        <option value="en">English</option>
                    </select>
                </label>
                <label>
                    皮肤{' '}
                    <select
                        aria-label="轮播验收皮肤"
                        value={preset}
                        onChange={e => setPreset(normalizeStorefrontVisualPreset(e.target.value))}
                    >
                        <option value="classic">经典</option>
                        <option value="neo-minimalist">新锐科技极简</option>
                    </select>
                </label>
                <label>
                    文案{' '}
                    <select
                        aria-label="轮播验收文案"
                        value={length}
                        onChange={e => setLength(e.target.value)}
                    >
                        <option value="saved">后台示例文案</option>
                        <option value="long">长文案示例</option>
                    </select>
                </label>
                {action && <span role="status">{action}</span>}
            </div>
            <div className={`storefront-app ${desktop ? 'desktop-store-layout' : ''}`}>
                <DesktopLayoutContext.Provider value={desktop}>
                    <HomePageContext.Provider value={homepageValue}>
                        <HomePage />
                    </HomePageContext.Provider>
                </DesktopLayoutContext.Provider>
            </div>
        </React.Fragment>
    );
}

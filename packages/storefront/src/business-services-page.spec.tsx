// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DesktopLayoutContext } from './desktop-layout';
import { BusinessServicesPage } from './pages/business-services-page';
import { BusinessServicesPageContext } from './storefront-page-contexts';
import { type RouteState } from './storefront-router';
import {
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontContentTargetType,
} from './types';

// Vitest stubs CSS imports by default. Keep the real resource text for SSR assertions.
vi.mock('./styles/service-entries.css?inline', async () => ({
    default: (await import('node:fs')).readFileSync(
        new URL('./styles/service-entries.css', new URL(import.meta.url)),
        'utf8',
    ),
}));
vi.mock('../../storefront-content-plugin/src/shared/business-services-hero.css?inline', async () => ({
    default: (await import('node:fs')).readFileSync(
        new URL(
            '../../storefront-content-plugin/src/shared/business-services-hero.css',
            new URL(import.meta.url),
        ),
        'utf8',
    ),
}));
vi.mock('./pages/business-services-page.css?inline', async () => ({
    default: (await import('node:fs')).readFileSync(
        new URL('./pages/business-services-page.css', new URL(import.meta.url)),
        'utf8',
    ),
}));

function businessPluginBlock(): StorefrontContentBlock {
    const item: StorefrontContentItem = {
        id: 'support-plugin',
        enabled: true,
        position: 0,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: {
            pluginCode: 'category-support-entry',
            placement: 'BUSINESS_SERVICES_MAIN',
            categoryScope: 'ALL',
            categoryIds: [],
            includeChildren: true,
        },
        label: '客服快捷入口',
        description: '',
    };
    return {
        id: 'client-plugins',
        code: 'storefront-client-plugins',
        type: 'CLIENT_PLUGINS',
        enabled: true,
        position: 10_001,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        title: '客户端插件配置',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [item],
    };
}

function navigationBlock(servicesLabel: string): StorefrontContentBlock {
    return {
        id: 'navigation',
        code: 'storefront-navigation',
        type: 'NAVIGATION',
        enabled: true,
        position: 10_000,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        title: '客户端导航',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [
            {
                id: 'services-navigation-item',
                enabled: true,
                position: 0,
                imageUrl: null,
                targetType: 'PAGE',
                targetValue: '/services',
                settings: null,
                label: servicesLabel,
                description: '',
            },
        ],
    };
}

function pageElement(
    contentBlocks: StorefrontContentBlock[],
    language: 'zh' | 'en' = 'zh',
    desktop = false,
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void = vi.fn(),
    onNavigate: (route: RouteState) => void = vi.fn(),
) {
    return (
        <BusinessServicesPageContext.Provider
            value={{
                contentBlocks,
                language,
                storefrontName: '测试商城',
                logoUrl: null,
                marketLabel: '马来西亚',
                displayCurrencyCode: 'MYR',
                availableCurrencyCodes: ['MYR'],
                currencyLoading: false,
                onToggleLanguage: vi.fn(),
                onCurrencyChange: vi.fn(),
                onNotifications: vi.fn(),
                onNavigate,
                onContentTarget,
            }}
        >
            <DesktopLayoutContext.Provider value={desktop}>
                <BusinessServicesPage />
            </DesktopLayoutContext.Provider>
        </BusinessServicesPageContext.Provider>
    );
}

function renderPage(contentBlocks: StorefrontContentBlock[], language: 'zh' | 'en' = 'zh', desktop = false) {
    // Existing assertions describe rendered elements/copy, not matching selectors inside CSS text.
    return renderToStaticMarkup(pageElement(contentBlocks, language, desktop)).replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gu,
        '',
    );
}

describe('business services page', () => {
    it('emits the real directory, hero and page CSS with SSR instead of waiting for a lazy stylesheet', () => {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(pageElement([businessPluginBlock()]));
        const directory = host.querySelector('style[data-href="storefront-service-entries"]');
        const page = host.querySelector('style[data-href="storefront-business-services"]');
        expect(directory?.getAttribute('data-precedence')).toBe('commerce');
        expect(directory?.textContent).toContain('.category-client-plugin');
        expect(page?.getAttribute('data-precedence')).toBe('services');
        expect(page?.textContent).toContain('.business-services-heading');
        expect(page?.textContent).toContain('.business-services-mobile-header');
        expect(page?.textContent).toContain('--services-hero-mobile-image-ratio');
        expect(page?.textContent).toContain('--services-hero-desktop-image-ratio');
    });

    function sidebarBlock(): StorefrontContentBlock {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1, businessServicesHeroLayout: 'shared-banner' };
        block.imageUrl = '/assets/shared-banner.png';
        block.imageAsset = { width: 1600, height: 900 };
        block.items = [
            'category-coupon-entry',
            'two-factor-code-tool',
            'category-support-entry',
            'ai-image-studio-entry',
            'icloud-mail-query-entry',
        ].map((pluginCode, position) => ({
            ...block.items[0],
            id: pluginCode,
            position,
            settings: { ...block.items[0].settings, pluginCode },
        }));
        return block;
    }

    it('places support above coupons beside the shared image and keeps tools below without duplication', () => {
        const block = sidebarBlock();
        for (const language of ['zh', 'en'] as const) {
            for (const desktop of [false, true]) {
                const host = document.createElement('div');
                host.innerHTML = renderPage([block], language, desktop);
                const row = host.querySelector('.business-services-advertising-row');
                const sidebar = row?.querySelector('aside');
                if (!row || !sidebar) throw new Error('Shared banner assistance is missing');
                expect(row.querySelector('.business-services-hero-media img')?.getAttribute('src')).toContain(
                    block.imageUrl,
                );
                expect(sidebar.querySelectorAll('button')).toHaveLength(2);
                expect(
                    sidebar.querySelector('button')?.classList.contains('category-client-plugin-support'),
                ).toBe(true);
                expect(sidebar.querySelector('.is-tools')).toBeNull();
                expect(host.querySelectorAll('.category-client-plugin')).toHaveLength(5);
                const tools = host.querySelector('.is-tools');
                if (!tools) throw new Error('Tool directory is missing');
                expect(row.contains(tools)).toBe(false);
                expect(tools.querySelectorAll('button')).toHaveLength(3);
                expect(
                    tools.querySelector('button')?.classList.contains('category-client-plugin-two-factor'),
                ).toBe(true);
                expect(row.compareDocumentPosition(tools)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            }
        }
    });

    it('omits disabled assistance and removes the sidebar when no eligible assistance or banner is enabled', () => {
        const block = sidebarBlock();
        block.items[0].enabled = false;
        const host = document.createElement('div');
        host.innerHTML = renderPage([block], 'zh', true);
        expect(host.querySelectorAll('aside button')).toHaveLength(1);
        expect(host.querySelector('.category-client-plugin-coupon')).toBeNull();
        block.items[2].enabled = false;
        expect(renderPage([block], 'zh', true)).not.toContain('business-services-assistance-sidebar');
        block.items[2].enabled = true;
        block.items[2].settings = { ...block.items[2].settings, placement: 'BEFORE_PRODUCT_LIST' };
        expect(renderPage([block], 'zh', true)).not.toContain('business-services-assistance-sidebar');
        block.items[2].settings.placement = 'BUSINESS_SERVICES_MAIN';
        for (const fallback of [
            { ...block, imageUrl: null, imageAsset: undefined },
            { ...block, enabled: false },
        ]) {
            expect(renderPage([fallback], 'zh', true)).not.toContain('business-services-assistance-sidebar');
        }
    });

    it('preserves the existing support, coupon and tool destinations after relocation', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const host = document.createElement('div');
        const root = createRoot(host);
        const navigate = vi.fn();
        try {
            await act(async () => {
                root.render(pageElement([sidebarBlock()], 'zh', true, vi.fn(), navigate));
                await Promise.resolve();
            });
            for (const [className, route] of [
                ['support', 'support'],
                ['coupon', 'coupons'],
                ['two-factor', 'two-factor'],
                ['image-studio', 'image-studio'],
                ['mail-query', 'mail-query'],
            ]) {
                await act(async () => {
                    (host.querySelector(`.category-client-plugin-${className}`) as HTMLButtonElement).click();
                    await Promise.resolve();
                });
                expect(navigate).toHaveBeenLastCalledWith({ name: route });
            }
            expect(navigate).toHaveBeenCalledTimes(5);
        } finally {
            await act(async () => {
                root.unmount();
                await Promise.resolve();
            });
            vi.unstubAllGlobals();
        }
    });

    it('puts enabled tools before assistance on both layouts and retains managed copy beside the title', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1 };
        block.title = '后台服务说明';
        block.body = '后台配置的说明';
        block.items.push({
            ...block.items[0],
            id: 'tool',
            position: 1,
            settings: { ...block.items[0].settings, pluginCode: 'two-factor-code-tool' },
        });
        const desktop = renderPage([block], 'zh', true);
        expect(desktop.indexOf('2FA 动态码')).toBeLessThan(desktop.indexOf('选购遇到问题？'));
        expect(desktop).toContain('class="business-services-heading"');
        expect(desktop).toContain('后台服务说明');
        expect(desktop).toContain('后台配置的说明');
        const mobile = renderPage([block]);
        expect(mobile.indexOf('2FA 动态码')).toBeLessThan(mobile.indexOf('选购遇到问题？'));
        expect(mobile).toContain('business-services-mobile-header');
        expect(mobile).toContain('locale-preferences-trigger');
        expect(mobile).toContain('<h1 class="business-services-page-title">后台服务说明</h1>');
        expect(mobile).not.toContain('<details');
    });
    it('shows the default navigation name and a module empty state before services are enabled', () => {
        const markup = renderPage([]);

        expect(markup).toContain('<h1 class="business-services-page-title">智能服务</h1>');
        expect(renderPage([], 'zh', true)).toContain(
            '<h1 class="business-services-page-title">智能服务</h1>',
        );
        expect(markup).not.toContain('business-services-title-icon');
        expect(markup).toContain('商业服务正在陆续开放');
    });

    it('keeps the page title synchronized with the configured bottom navigation label', () => {
        const markup = renderPage([navigationBlock('AI 智能服务')]);

        expect(markup).toContain('<strong>AI 智能服务</strong>');
        expect(markup).not.toContain('business-services-heading-kicker');
    });

    it('renders enabled plugins in the business-services main position', () => {
        const markup = renderPage([businessPluginBlock()]);

        expect(markup).toContain('选购遇到问题？');
        expect(markup).not.toContain('商业服务正在陆续开放');
    });

    it('renders the managed title and description for the active storefront language', () => {
        const chineseBlock = businessPluginBlock();
        chineseBlock.settings = { businessServicesCopyVersion: 1 };
        chineseBlock.title = '定制商业服务';
        chineseBlock.body = '从这里开始使用店铺工具。';

        const englishBlock = {
            ...chineseBlock,
            title: 'Services for your business',
            body: 'Start using store tools here.',
        };

        expect(renderPage([chineseBlock])).toContain('定制商业服务');
        expect(renderPage([chineseBlock])).toContain('从这里开始使用店铺工具。');
        expect(renderPage([englishBlock], 'en')).toContain('Services for your business');
        expect(renderPage([englishBlock], 'en')).toContain('Start using store tools here.');
    });

    it('ignores legacy subtitles and does not add a navigation-name eyebrow on either layout', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1 };
        block.title = '商家设置的标题';
        block.body = '商家设置的说明';
        block.subtitle = '与默认站使用同一插件版本';
        for (const desktop of [false, true]) {
            const markup = renderPage([block], 'zh', desktop);
            expect(markup).toContain('商家设置的标题');
            expect(markup).toContain('商家设置的说明');
            expect(markup).not.toContain('与默认站使用同一插件版本');
            expect(markup).not.toContain('business-services-heading-kicker');
            expect(renderPage([{ ...block, subtitle: '' }], 'zh', desktop)).not.toContain(
                'business-services-heading-kicker',
            );
            expect(
                renderPage(
                    [{ ...block, subtitle: 'Uses the same plugin version as the default site' }],
                    'en',
                    desktop,
                ),
            ).not.toContain('Uses the same plugin version as the default site');
        }
    });

    it('renders a localized jump action when the managed hero has a URL target', () => {
        const linkedBlock = businessPluginBlock();
        linkedBlock.settings = { businessServicesCopyVersion: 1 };
        linkedBlock.targetType = 'URL';
        linkedBlock.targetValue = 'https://example.com/services';

        expect(renderPage([linkedBlock])).toContain('business-services-heading-link');
        expect(renderPage([linkedBlock])).toContain('打开服务网站');
        expect(renderPage([linkedBlock], 'en')).toContain('Open service website');
    });

    it('does not render the jump action without a managed URL target', () => {
        const unmanagedBlock = businessPluginBlock();
        unmanagedBlock.targetType = 'URL';
        unmanagedBlock.targetValue = 'https://example.com/services';

        expect(renderPage([unmanagedBlock])).not.toContain('business-services-heading-link');
    });

    it('keeps the built-in copy until the existing plugin block is saved from the new editor', () => {
        const legacyBlock = businessPluginBlock();
        legacyBlock.title = '客户端插件配置';
        legacyBlock.body = '';

        const markup = renderPage([legacyBlock]);

        expect(markup).toContain('智能服务');
        expect(markup).not.toContain('客户端插件配置');
    });
    it('uses the same configured introduction, CTA and image across viewports without duplicate tools', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1 };
        block.title = '商家服务介绍';
        block.body = '后台提供的介绍内容';
        block.ctaLabel = '了解服务详情';
        block.targetType = 'URL';
        block.targetValue = 'https://example.invalid/service';
        block.imageUrl = '/assets/managed-service.webp';
        block.items.push({
            ...block.items[0],
            id: 'two-factor-tool',
            position: 1,
            settings: { ...block.items[0].settings, pluginCode: 'two-factor-code-tool' },
        });
        for (const desktop of [false, true]) {
            const markup = renderPage([block], 'zh', desktop);
            expect(markup).toContain('商家服务介绍');
            expect(markup).toContain('后台提供的介绍内容');
            expect(markup).toContain('了解服务详情');
            expect(markup).toContain('/assets/managed-service.webp');
            expect(markup).not.toContain('business-services-architecture');
            expect(markup.match(/category-client-plugin-two-factor/g)).toHaveLength(1);
            expect(markup).not.toContain('business-services-hero-shortcuts');
            expect(markup).not.toContain('直通服务');
        }
    });

    it('uses one image for the fixed banner without clearing the recoverable phone binding', () => {
        const block = businessPluginBlock();
        block.title = '模钥 AI 中转';
        block.body = '多模型，充值未开放';
        block.imageUrl = '/assets/shared-wide.webp';
        block.imageAsset = { width: 1600, height: 900 };
        block.settings = {
            businessServicesCopyVersion: 1,
            businessServicesHeroLayout: 'shared-banner',
            mobileImageUrl: '/assets/legacy-phone.webp',
            mobileImageWidth: 1000,
            mobileImageHeight: 1000,
        };
        for (const desktop of [false, true]) {
            const markup = renderPage([block], 'zh', desktop);
            expect(markup).toContain('data-services-hero-layout="shared-banner"');
            expect(markup).toContain('/assets/shared-wide.webp');
            expect(markup).not.toContain('/assets/legacy-phone.webp');
            expect(markup).not.toContain('--services-hero-image-ratio');
            expect(markup).toContain('多模型，充值未开放');
        }
        expect(block.settings.mobileImageUrl).toBe('/assets/legacy-phone.webp');
        block.settings.businessServicesHeroLayout = 'image-overlay';
        expect(renderPage([block], 'zh', false)).toContain('/assets/legacy-phone.webp');
    });

    it('selects independent phone artwork and preserves complete image geometry, with desktop inheritance when unset', () => {
        const block = businessPluginBlock();
        block.settings = {
            businessServicesCopyVersion: 1,
            businessServicesHeroLayout: 'image-overlay',
            mobileImageUrl: '/assets/phone-square.webp',
            mobileImageAssetId: 'phone',
            mobileImageWidth: 1254,
            mobileImageHeight: 1254,
        };
        block.imageUrl = '/assets/desktop-wide.webp';
        block.imageAsset = { width: 2169, height: 725 };
        const phone = document.createElement('div');
        phone.innerHTML = renderPage([block], 'zh', false);
        expect(phone.querySelector('.business-services-hero-media img')?.getAttribute('src')).toContain(
            '/assets/desktop-wide.webp',
        );
        expect(phone.querySelector('.business-services-hero-media img')?.getAttribute('loading')).toBe(
            'eager',
        );
        expect(phone.querySelector('.business-services-hero-media img')?.getAttribute('fetchpriority')).toBe(
            'high',
        );
        expect(phone.querySelector('picture source')?.getAttribute('media')).toBe('(max-width: 1023px)');
        expect(phone.querySelector('picture source')?.getAttribute('srcset')).toContain(
            '/assets/phone-square.webp',
        );
        expect(
            phone
                .querySelector<HTMLElement>('.business-services-workspace')
                ?.style.getPropertyValue('--services-hero-mobile-image-ratio'),
        ).toBe('1');
        const desktop = document.createElement('div');
        desktop.innerHTML = renderPage([block], 'en', true);
        expect(desktop.querySelector('.business-services-hero-media img')?.getAttribute('src')).toContain(
            '/assets/desktop-wide.webp',
        );
        expect(desktop.querySelector('.business-services-hero-media img')?.getAttribute('loading')).toBe(
            'eager',
        );
        expect(
            desktop.querySelector('.business-services-hero-media img')?.getAttribute('fetchpriority'),
        ).toBe('high');
        expect(
            Number(
                desktop
                    .querySelector<HTMLElement>('.business-services-workspace')
                    ?.style.getPropertyValue('--services-hero-desktop-image-ratio'),
            ),
        ).toBeCloseTo(2169 / 725);
        block.settings.mobileImageUrl = null;
        const inherited = document.createElement('div');
        inherited.innerHTML = renderPage([block], 'zh', false);
        expect(inherited.querySelector('.business-services-hero-media img')?.getAttribute('src')).toContain(
            '/assets/desktop-wide.webp',
        );
        expect(renderPage([{ ...block, enabled: false }], 'zh', false)).not.toContain(
            '/assets/phone-square.webp',
        );
    });

    it('hydrates the same header and picture nodes and keeps them when desktop capability is adopted', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const block = businessPluginBlock();
        block.settings = {
            businessServicesHeroLayout: 'image-overlay',
            mobileImageUrl: '/assets/phone-square.webp',
            mobileImageWidth: 1000,
            mobileImageHeight: 1000,
        };
        block.imageUrl = '/assets/desktop-wide.webp';
        block.imageAsset = { width: 2000, height: 800 };
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(pageElement([block], 'zh', false));
        document.body.append(host);
        const header = host.querySelector('.business-services-mobile-header');
        const hero = host.querySelector('.business-services-heading');
        const image = host.querySelector('.business-services-hero-media img');
        const errors = vi.fn();
        let root: ReturnType<typeof hydrateRoot> | undefined;
        try {
            await act(async () => {
                root = hydrateRoot(host, pageElement([block], 'zh', false), { onRecoverableError: errors });
                await Promise.resolve();
            });
            if (!root) throw new Error('Expected hydrated services root');
            const hydratedRoot = root;
            await act(async () => {
                hydratedRoot.render(pageElement([block], 'zh', true));
                await Promise.resolve();
            });
            expect(errors).not.toHaveBeenCalled();
            expect(host.querySelector('.business-services-mobile-header')).toBe(header);
            expect(host.querySelector('.business-services-heading')).toBe(hero);
            expect(host.querySelector('.business-services-hero-media img')).toBe(image);
            expect(image?.getAttribute('src')).toContain('/assets/desktop-wide.webp');
            expect(host.querySelector('source')?.getAttribute('srcset')).toContain(
                '/assets/phone-square.webp',
            );
        } finally {
            const mountedRoot = root;
            if (mountedRoot)
                await act(async () => {
                    mountedRoot.unmount();
                    await Promise.resolve();
                });
            host.remove();
            vi.unstubAllGlobals();
        }
    });

    it('keeps a mobile-only binding out of the desktop fallback without cloning tools or action ids', () => {
        const block = businessPluginBlock();
        block.settings = {
            businessServicesCopyVersion: 1,
            businessServicesHeroLayout: 'image-overlay',
            mobileImageUrl: '/assets/phone-only.webp',
            mobileImageWidth: 1000,
            mobileImageHeight: 1000,
        };
        block.targetType = 'URL';
        block.targetValue = '/services';
        const host = document.createElement('div');
        host.innerHTML = renderPage([block], 'zh', false);
        const mobileHero = host.querySelector('.business-services-mobile-only-hero');
        const desktopFallback = host.querySelector('.business-services-desktop-empty-hero');
        expect(mobileHero?.querySelector('img')?.getAttribute('src')).toContain('/assets/phone-only.webp');
        expect(mobileHero?.querySelector('img')?.getAttribute('loading')).toBe('lazy');
        expect(mobileHero?.querySelector('img')?.getAttribute('fetchpriority')).not.toBe('high');
        expect(desktopFallback?.getAttribute('data-services-hero-layout')).toBe('stacked');
        expect(desktopFallback?.querySelector('img')).toBeNull();
        expect(desktopFallback?.querySelector('.business-services-architecture')).not.toBeNull();
        expect(host.querySelectorAll('.business-services-hero-media img')).toHaveLength(1);
        expect(host.querySelectorAll('.category-client-plugin-support')).toHaveLength(1);
        expect(host.querySelectorAll('.business-services-heading-link[id]')).toHaveLength(0);
        expect(renderPage([block], 'zh', true)).toBe(renderPage([block], 'zh', false));
    });

    it('retains the existing stacked image and copy until a merchant explicitly selects the new layout', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1 };
        block.imageUrl = '/assets/existing-artwork-with-copy.webp';
        for (const desktop of [false, true]) {
            const markup = renderPage([block], 'zh', desktop);
            expect(markup).toContain('data-services-hero-layout="stacked"');
            expect(markup).toContain('/assets/existing-artwork-with-copy.webp');
            expect(markup.indexOf('business-services-hero-media')).toBeLessThan(
                markup.indexOf('business-services-heading-copy'),
            );
            expect(
                renderPage(
                    [{ ...block, settings: { ...block.settings, businessServicesHeroLayout: 'unknown' } }],
                    'zh',
                    desktop,
                ),
            ).toContain('data-services-hero-layout="stacked"');
        }
    });

    it('falls back to a readable introduction when the selected artwork layout has no enabled image', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1, businessServicesHeroLayout: 'image-overlay' };
        block.title = '无图片也能查看服务';
        block.body = '完整保留介绍和店铺工具。';
        for (const desktop of [false, true]) {
            for (const imageBlock of [block, { ...block, enabled: false, imageUrl: '/assets/hidden.webp' }]) {
                const markup = renderPage([imageBlock], 'zh', desktop);
                expect(markup).toContain('data-services-hero-layout="stacked"');
                expect(markup).toContain('无图片也能查看服务');
                expect(markup).toContain('完整保留介绍和店铺工具。');
                expect(markup).toContain('business-services-architecture');
                expect(markup).not.toContain('business-services-hero-media');
            }
        }
    });

    it('uses existing managed colors and manual line breaks only in the optional artwork layout', () => {
        const block = businessPluginBlock();
        block.settings = {
            businessServicesCopyVersion: 1,
            businessServicesHeroLayout: 'image-overlay',
            secondaryTextColor: '#344b65',
        };
        block.imageUrl = '/assets/text-free-services.webp';
        block.title = '多款模型\n一站连接';
        block.backgroundColor = '#f7fbff';
        block.textColor = '#1748ff';
        const host = document.createElement('div');
        host.innerHTML = renderPage([block], 'zh', true);
        expect(host.querySelector('.business-services-page-title')?.textContent).toBe(block.title);
        const heading = host.querySelector<HTMLElement>('.business-services-heading');
        expect(heading?.style.getPropertyValue('--hero-copy-background')).toBe('#f7fbff');
        expect(heading?.style.getPropertyValue('--hero-copy-foreground')).toBe('#1748ff');
        expect(heading?.style.getPropertyValue('--hero-copy-body-foreground')).toBe('#344b65');
        host.innerHTML = renderPage([{ ...block, settings: { businessServicesCopyVersion: 1 } }], 'zh', true);
        expect(host.querySelector('.business-services-heading')?.getAttribute('style')).toBeNull();
    });

    it('keeps long localized copy literal and complete in the optional artwork layout', () => {
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1, businessServicesHeroLayout: 'image-overlay' };
        block.imageUrl = '/assets/text-free-services.webp';
        const copies = [
            { language: 'zh' as const, title: '智能服务与专属权益'.repeat(8), body: '完整说明\n'.repeat(30) },
            {
                language: 'en' as const,
                title: 'Tools and services for your business '.repeat(8),
                body: 'All of the service details remain readable.\n'.repeat(30),
            },
        ];
        for (const copy of copies) {
            for (const desktop of [false, true]) {
                const host = document.createElement('div');
                host.innerHTML = renderPage(
                    [{ ...block, title: `${copy.title}<script>literal</script>`, body: copy.body }],
                    copy.language,
                    desktop,
                );
                expect(
                    host
                        .querySelector('.business-services-heading')
                        ?.getAttribute('data-services-hero-layout'),
                ).toBe('image-overlay');
                expect(host.querySelector('.business-services-page-title')?.textContent).toBe(
                    `${copy.title}<script>literal</script>`,
                );
                expect(host.querySelector('.business-services-heading-copy p')?.textContent).toBe(
                    copy.body.trim(),
                );
                expect(host.querySelector('script')).toBeNull();
                expect(
                    host.querySelector('.business-services-hero-media img')?.getAttribute('src'),
                ).toContain('/assets/text-free-services.webp');
            }
        }
    });

    it('updates localized copy and the selected layout without losing the configured action or image', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const block = businessPluginBlock();
        block.settings = { businessServicesCopyVersion: 1, businessServicesHeroLayout: 'image-overlay' };
        block.imageUrl = '/assets/text-free-services.webp';
        block.title = '智能服务';
        block.body = '中文服务说明';
        block.ctaLabel = '了解详情';
        block.targetType = 'URL';
        block.targetValue = '/promotions';
        const onContentTarget = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const flushAction = async (action: () => void) => {
            await act(async () => {
                action();
                await Promise.resolve();
            });
        };
        try {
            await flushAction(() => root.render(pageElement([block], 'zh', true, onContentTarget)));
            const hero = () => host.querySelector('.business-services-heading');
            expect(hero()?.getAttribute('data-services-hero-layout')).toBe('image-overlay');
            expect(hero()?.textContent).toContain('中文服务说明');
            await flushAction(() => {
                (host.querySelector('.business-services-heading-link') as HTMLButtonElement).click();
            });
            expect(onContentTarget).toHaveBeenLastCalledWith('URL', '/promotions');

            const englishBlock = {
                ...block,
                title: 'Intelligent services',
                body: 'Service details in English',
                ctaLabel: 'Learn more',
            };
            await flushAction(() => root.render(pageElement([englishBlock], 'en', true, onContentTarget)));
            expect(hero()?.textContent).toContain('Intelligent services');
            expect(hero()?.textContent).toContain('Service details in English');
            expect(hero()?.textContent).not.toContain('中文服务说明');
            expect(hero()?.getAttribute('data-services-hero-layout')).toBe('image-overlay');

            await flushAction(() =>
                root.render(
                    pageElement(
                        [
                            {
                                ...englishBlock,
                                settings: { ...block.settings, businessServicesHeroLayout: 'stacked' },
                            },
                        ],
                        'en',
                        true,
                        onContentTarget,
                    ),
                ),
            );
            expect(hero()?.getAttribute('data-services-hero-layout')).toBe('stacked');
            expect(host.querySelector('.business-services-hero-media img')?.getAttribute('src')).toContain(
                '/assets/text-free-services.webp',
            );
            await flushAction(() => {
                (host.querySelector('.business-services-heading-link') as HTMLButtonElement).click();
            });
            expect(onContentTarget).toHaveBeenCalledTimes(2);
            expect(onContentTarget).toHaveBeenLastCalledWith('URL', '/promotions');
        } finally {
            await flushAction(() => root.unmount());
            host.remove();
            vi.unstubAllGlobals();
        }
    });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DesktopLayoutContext } from './desktop-layout';
import { BusinessServicesPage } from './pages/business-services-page';
import { BusinessServicesPageContext } from './storefront-page-contexts';
import {
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontContentTargetType,
} from './types';

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
                onNavigate: () => undefined,
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
    return renderToStaticMarkup(pageElement(contentBlocks, language, desktop));
}

describe('business services page', () => {
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

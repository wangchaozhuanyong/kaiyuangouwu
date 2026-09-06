import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DesktopLayoutContext } from './desktop-layout';
import { BusinessServicesPage } from './pages/business-services-page';
import { BusinessServicesPageContext } from './storefront-page-contexts';
import { type StorefrontContentBlock, type StorefrontContentItem } from './types';

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

function renderPage(contentBlocks: StorefrontContentBlock[], language: 'zh' | 'en' = 'zh', desktop = false) {
    return renderToStaticMarkup(
        <BusinessServicesPageContext.Provider
            value={{
                contentBlocks,
                language,
                onNavigate: () => undefined,
                onContentTarget: vi.fn(),
            }}
        >
            <DesktopLayoutContext.Provider value={desktop}>
                <BusinessServicesPage />
            </DesktopLayoutContext.Provider>
        </BusinessServicesPageContext.Provider>,
    );
}

describe('business services page', () => {
    it('puts enabled tools before assistance on desktop and retains managed copy in the disclosure', () => {
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
        expect(desktop).toContain('<details class="desktop-service-description">');
        expect(desktop).toContain('后台服务说明');
        expect(desktop).toContain('后台配置的说明');
        const mobile = renderPage([block]);
        expect(mobile.indexOf('选购遇到问题？')).toBeLessThan(mobile.indexOf('2FA 动态码'));
        expect(mobile).not.toContain('<details');
    });
    it('shows the centered default navigation name and an empty state before services are enabled', () => {
        const markup = renderPage([]);

        expect(markup).toContain('<h1 class="business-services-page-title">智能服务</h1>');
        expect(markup).not.toContain('business-services-title-icon');
        expect(markup).toContain('商业服务正在陆续开放');
    });

    it('keeps the page title synchronized with the configured bottom navigation label', () => {
        const markup = renderPage([navigationBlock('AI 智能服务')]);

        expect(markup).toContain('<h1 class="business-services-page-title">AI 智能服务</h1>');
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

    it('renders a localized jump action when the managed hero has a URL target', () => {
        const linkedBlock = businessPluginBlock();
        linkedBlock.settings = { businessServicesCopyVersion: 1 };
        linkedBlock.targetType = 'URL';
        linkedBlock.targetValue = 'https://example.com/services';

        expect(renderPage([linkedBlock])).toContain('business-services-hero-link');
        expect(renderPage([linkedBlock])).toContain('访问链接');
        expect(renderPage([linkedBlock], 'en')).toContain('Open link');
    });

    it('does not render the jump action without a managed URL target', () => {
        const unmanagedBlock = businessPluginBlock();
        unmanagedBlock.targetType = 'URL';
        unmanagedBlock.targetValue = 'https://example.com/services';

        expect(renderPage([unmanagedBlock])).not.toContain('business-services-hero-link');
    });

    it('keeps the built-in copy until the existing plugin block is saved from the new editor', () => {
        const legacyBlock = businessPluginBlock();
        legacyBlock.title = '客户端插件配置';
        legacyBlock.body = '';

        const markup = renderPage([legacyBlock]);

        expect(markup).toContain('发现更多商业能力');
        expect(markup).not.toContain('客户端插件配置');
    });
});

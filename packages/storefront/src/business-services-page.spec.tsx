import type { StorefrontContentBlock, StorefrontContentItem } from './types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BusinessServicesPage } from './pages/business-services-page';
import { StorefrontContext } from './StorefrontContext';

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

function renderPage(contentBlocks: StorefrontContentBlock[]) {
    return renderToStaticMarkup(
        <StorefrontContext.Provider value={{ contentBlocks, language: 'zh', onNavigate: () => undefined }}>
            <BusinessServicesPage />
        </StorefrontContext.Provider>,
    );
}

describe('business services page', () => {
    it('shows the default page name and an empty state before services are enabled', () => {
        const markup = renderPage([]);

        expect(markup).toContain('商业服务');
        expect(markup).toContain('商业服务正在陆续开放');
    });

    it('renders enabled plugins in the business-services main position', () => {
        const markup = renderPage([businessPluginBlock()]);

        expect(markup).toContain('选购遇到问题？');
        expect(markup).not.toContain('商业服务正在陆续开放');
    });
});

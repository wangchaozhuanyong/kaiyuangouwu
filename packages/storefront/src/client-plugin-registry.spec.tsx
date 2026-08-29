import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StorefrontContentBlock, StorefrontContentItem } from './types';

import {
    CategoryClientPluginSlot,
    ClientPluginSlot,
    resolveCategoryClientPlugins,
    resolveClientPlugins,
} from './client-plugins/client-plugin-registry';

function pluginItem(
    code: string,
    placement: string,
    position: number,
    settings: Record<string, unknown> = {},
): StorefrontContentItem {
    return {
        id: `${code}-${position}`,
        enabled: true,
        position,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: { pluginCode: code, placement, ...settings },
        label: code,
        description: '',
    };
}

function pluginBlock(items: StorefrontContentItem[]): StorefrontContentBlock {
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
        items,
    };
}

describe('category client plugin registry', () => {
    it('resolves registered plugins by placement and configured order', () => {
        const block = pluginBlock([
            pluginItem('category-support-entry', 'BEFORE_PRODUCT_LIST', 2),
            pluginItem('category-coupon-entry', 'BEFORE_PRODUCT_LIST', 1),
            pluginItem('category-support-entry', 'AFTER_PRODUCT_LIST', 0),
        ]);

        expect(resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST').map(item => item.code)).toEqual([
            'category-coupon-entry',
            'category-support-entry',
        ]);
    });

    it('ignores unknown plugins, invalid placements and disabled layouts', () => {
        const block = pluginBlock([
            pluginItem('not-released', 'BEFORE_PRODUCT_LIST', 0),
            pluginItem('category-coupon-entry', 'NOT_A_SLOT', 1),
        ]);

        expect(resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST')).toEqual([]);
        block.enabled = false;
        expect(resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST')).toEqual([]);
    });

    it('renders the configured customer-facing plugin in its slot', () => {
        const markup = renderToStaticMarkup(
            <CategoryClientPluginSlot
                block={pluginBlock([pluginItem('category-coupon-entry', 'BEFORE_PRODUCT_LIST', 0)])}
                placement="BEFORE_PRODUCT_LIST"
                categoryContext={{
                    activeCollectionId: 'all',
                    ancestorCollectionIds: [],
                }}
                language="zh"
                onNavigate={() => undefined}
            />,
        );

        expect(markup).toContain('先领券，再选购');
        expect(markup).toContain('去领券');
        expect(markup).toContain('is-before-product-list');
    });

    it('shows selected-category plugins only in the configured category tree', () => {
        const item = pluginItem('category-coupon-entry', 'BEFORE_PRODUCT_LIST', 0, {
            categoryScope: 'SELECTED',
            categoryIds: ['digital-products'],
            includeChildren: true,
        });
        const block = pluginBlock([item]);

        expect(
            resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST', {
                activeCollectionId: 'software',
                ancestorCollectionIds: ['digital-products'],
            }).map(plugin => plugin.code),
        ).toEqual(['category-coupon-entry']);
        expect(
            resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST', {
                activeCollectionId: 'home-goods',
                ancestorCollectionIds: [],
            }),
        ).toEqual([]);

        item.settings = { ...item.settings, includeChildren: false };
        expect(
            resolveCategoryClientPlugins(block, 'BEFORE_PRODUCT_LIST', {
                activeCollectionId: 'software',
                ancestorCollectionIds: ['digital-products'],
            }),
        ).toEqual([]);
    });

    it('shows business-service plugins without applying category restrictions', () => {
        const block = pluginBlock([
            pluginItem('category-support-entry', 'BUSINESS_SERVICES_MAIN', 1, {
                categoryScope: 'SELECTED',
                categoryIds: [],
                includeChildren: true,
            }),
            pluginItem('category-coupon-entry', 'BEFORE_PRODUCT_LIST', 0),
        ]);

        expect(resolveClientPlugins(block, 'BUSINESS_SERVICES_MAIN').map(plugin => plugin.code)).toEqual([
            'category-support-entry',
        ]);

        const markup = renderToStaticMarkup(
            <ClientPluginSlot
                block={block}
                placement="BUSINESS_SERVICES_MAIN"
                language="zh"
                onNavigate={() => undefined}
            />,
        );
        expect(markup).toContain('选购遇到问题？');
        expect(markup).toContain('is-business-services-main');
    });

    it('renders the AI image studio entry only when the client plugin is enabled', () => {
        const item = pluginItem('ai-image-studio-entry', 'BUSINESS_SERVICES_MAIN', 0);
        const block = pluginBlock([item]);
        const markup = renderToStaticMarkup(
            <ClientPluginSlot
                block={block}
                placement="BUSINESS_SERVICES_MAIN"
                language="zh"
                onNavigate={() => undefined}
            />,
        );

        expect(markup).toContain('AI 图片工坊');
        expect(markup).toContain('开始创作');
        item.enabled = false;
        expect(resolveClientPlugins(block, 'BUSINESS_SERVICES_MAIN')).toEqual([]);
    });

    it('renders the registered 2FA client plugin', () => {
        const markup = renderToStaticMarkup(
            <ClientPluginSlot
                block={pluginBlock([pluginItem('two-factor-code-tool', 'BUSINESS_SERVICES_MAIN', 0)])}
                placement="BUSINESS_SERVICES_MAIN"
                language="zh"
                onNavigate={() => undefined}
            />,
        );

        expect(markup).toContain('2FA 动态码');
        expect(markup).toContain('立即使用');
        expect(
            resolveClientPlugins(
                pluginBlock([pluginItem('two-factor-code-tool', 'BUSINESS_SERVICES_MAIN', 0)]),
                'BUSINESS_SERVICES_MAIN',
            ).map(plugin => plugin.code),
        ).toEqual(['two-factor-code-tool']);
    });
});

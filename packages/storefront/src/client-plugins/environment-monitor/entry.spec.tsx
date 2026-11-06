// organize-imports-ignore -- Preserve ESLint type groups.
import type { StorefrontContentBlock } from '../../types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { storefrontClientPluginCatalog } from '../../../../storefront-content-plugin/src/client-plugin-manifest';
import { desktopPageFamily } from '../../desktop-page-contract';
import { isPublicStorefrontRoute } from '../../storefront-access';
import { routePath } from '../../storefront-router';
import { resolveClientPlugins } from '../client-plugin-registry';

describe('environment monitor storefront registration', () => {
    it('registers an optional published tool with the agreed name and common route', () => {
        const entry = storefrontClientPluginCatalog.find(
            plugin => plugin.code === 'environment-monitor-entry',
        );
        expect(entry).toMatchObject({ name: '环境检测', defaultPlacement: 'BUSINESS_SERVICES_MAIN' });
        expect(routePath('environment-monitor')).toBe('/environment-monitor');
        expect(isPublicStorefrontRoute('environment-monitor')).toBe(true);
        expect(desktopPageFamily('environment-monitor')).toBe('tools');
        const block = {
            enabled: true,
            type: 'CLIENT_PLUGINS',
            code: 'storefront-client-plugins',
            items: [
                {
                    id: 'monitor',
                    enabled: true,
                    position: 0,
                    settings: {
                        pluginCode: requiredValue(entry).code,
                        placement: requiredValue(entry).defaultPlacement,
                    },
                },
            ],
        } as unknown as StorefrontContentBlock;
        const plugins = resolveClientPlugins(block, 'BUSINESS_SERVICES_MAIN');
        expect(plugins).toHaveLength(1);
        const Entry = plugins[0].Component;
        expect(renderToStaticMarkup(<Entry language="zh" onNavigate={vi.fn()} />)).toContain('环境检测');
        expect(resolveClientPlugins({ ...block, enabled: false }, 'BUSINESS_SERVICES_MAIN')).toEqual([]);
        expect(
            resolveClientPlugins(
                { ...block, items: [{ ...block.items[0], enabled: false }] },
                'BUSINESS_SERVICES_MAIN',
            ),
        ).toEqual([]);
        expect(resolveClientPlugins(undefined, 'BUSINESS_SERVICES_MAIN')).toEqual([]);
    });
});

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}

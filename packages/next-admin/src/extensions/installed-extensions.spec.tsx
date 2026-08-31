import { describe, expect, it } from 'vitest';

import {
    getNextAdminExtensionNavItems,
    getNextAdminExtensionRoutes,
    getNextAdminExtensions,
} from './extension-api';
import './installed-extensions';

describe('installed next-admin extensions', () => {
    it('registers all six local plugins through the shared extension API', () => {
        expect(getNextAdminExtensions().map(extension => extension.id)).toEqual([
            'image-generation-plugin',
            'content-translation-plugin',
            'storefront-content-plugin',
            'operations-dashboard-plugin',
            'store-management-plugin',
            'store-domain-plugin',
        ]);
    });

    it('provides unique routes plus the plugin navigation entries', () => {
        const routes = getNextAdminExtensionRoutes();
        expect(routes).toHaveLength(21);
        expect(new Set(routes.map(route => route.id)).size).toBe(routes.length);
        expect(new Set(routes.map(route => route.path)).size).toBe(routes.length);
        expect(getNextAdminExtensionNavItems('plugins').map(route => route.path)).toEqual([
            '/plugins/client-plugins',
            '/plugins/ai-settings',
            '/plugins/ai-access',
            '/plugins/translations',
        ]);
    });
});

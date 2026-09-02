import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defineNextAdminExtension,
    getNextAdminDashboardAlerts,
    getNextAdminDashboardWidgets,
    getNextAdminExtensionLegacyRoutes,
    getNextAdminExtensionNavItems,
    getNextAdminExtensionRoute,
    getNextAdminExtensionRoutes,
    resetNextAdminExtensionsForTests,
} from './extension-api';

const Component = vi.fn(() => null);

describe('next-admin extension registry', () => {
    beforeEach(() => resetNextAdminExtensionsForTests());

    it('registers routes and orders navigation items', () => {
        defineNextAdminExtension({
            id: 'example',
            routes: [
                {
                    id: 'second',
                    path: '/plugins/second',
                    title: 'Second',
                    component: Component,
                    navItem: { label: 'Second', sectionId: 'plugins', order: 20 },
                },
                {
                    id: 'first',
                    path: '/plugins/first',
                    legacyPaths: ['/first'],
                    title: 'First',
                    component: Component,
                    navItem: { label: 'First', sectionId: 'plugins', order: 10 },
                },
            ],
        });

        expect(getNextAdminExtensionRoutes()).toHaveLength(2);
        expect(getNextAdminExtensionRoute('/plugins/first')?.id).toBe('first');
        expect(getNextAdminExtensionRoute('/first')?.id).toBe('first');
        expect(getNextAdminExtensionLegacyRoutes()).toEqual([
            { id: 'first:legacy:/first', path: '/first', target: '/plugins/first' },
        ]);
        expect(getNextAdminExtensionNavItems('plugins').map(route => route.id)).toEqual(['first', 'second']);
    });

    it('registers ordered dashboard widgets and alerts', () => {
        defineNextAdminExtension({
            id: 'dashboard-example',
            dashboardWidgets: [
                { id: 'late', title: 'Late', component: Component, order: 20 },
                { id: 'early', title: 'Early', component: Component, order: 10 },
            ],
            alerts: [
                { id: 'late-alert', component: Component, order: 20 },
                { id: 'early-alert', component: Component, order: 10 },
            ],
        });

        expect(getNextAdminDashboardWidgets().map(item => item.id)).toEqual(['early', 'late']);
        expect(getNextAdminDashboardAlerts().map(item => item.id)).toEqual(['early-alert', 'late-alert']);
    });

    it('rejects duplicate extension ids and route paths', () => {
        defineNextAdminExtension({
            id: 'example',
            routes: [
                {
                    id: 'first',
                    path: '/plugins/first',
                    title: 'First',
                    component: Component,
                },
            ],
        });

        expect(() => defineNextAdminExtension({ id: 'example' })).toThrow(/already registered/);
        expect(() =>
            defineNextAdminExtension({
                id: 'another',
                routes: [
                    {
                        id: 'another-route',
                        path: '/plugins/first',
                        title: 'Another',
                        component: Component,
                    },
                ],
            }),
        ).toThrow(/path already registered/);

        expect(() =>
            defineNextAdminExtension({
                id: 'legacy-duplicate',
                routes: [
                    {
                        id: 'legacy-duplicate-route',
                        path: '/plugins/legacy-duplicate',
                        legacyPaths: ['/plugins/first'],
                        title: 'Legacy duplicate',
                        component: Component,
                    },
                ],
            }),
        ).toThrow(/path already registered/);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    defineNextAdminExtension,
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
                    title: 'First',
                    component: Component,
                    navItem: { label: 'First', sectionId: 'plugins', order: 10 },
                },
            ],
        });

        expect(getNextAdminExtensionRoutes()).toHaveLength(2);
        expect(getNextAdminExtensionRoute('/plugins/first')?.id).toBe('first');
        expect(getNextAdminExtensionNavItems('plugins').map(route => route.id)).toEqual(['first', 'second']);
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
    });
});

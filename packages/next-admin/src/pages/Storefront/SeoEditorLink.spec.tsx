// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { BEFORE_APP_NAVIGATION_EVENT } from '../../hooks/use-unsaved-changes-warning';
import { SeoEditorLink } from './SeoEditorLink';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
function Location() {
    const location = useLocation();
    return <output>{location.pathname + location.search}</output>;
}
function render(targetType: 'PRODUCT' | 'COLLECTION', permissions: string[], ready = true) {
    const entity = targetType === 'PRODUCT' ? 'products' : 'collections';
    const baseCapability = targetType === 'PRODUCT' ? '/catalog/products' : '/catalog/categories/categories';
    const basePath = targetType === 'PRODUCT' ? '/catalog/products/42' : baseCapability;
    act(() =>
        root.render(
            <MemoryRouter initialEntries={[basePath]}>
                <AdminPermissionsContext.Provider
                    value={{
                        permissions,
                        hasAnyPermission: required =>
                            required.some(permission => permissions.includes(permission)),
                    }}
                >
                    <AdminCapabilitiesContext.Provider
                        value={{
                            channelId: 'a',
                            channelCode: 'store-a',
                            scope: 'STORE',
                            commerceMode: 'PHYSICAL_ONLY',
                            capabilities: [
                                {
                                    id: baseCapability,
                                    state: 'READY',
                                    canRead: true,
                                    canWrite: false,
                                    canConfigure: false,
                                },
                                {
                                    id: `/catalog/${entity}/seo`,
                                    state: ready ? 'READY' : 'FORBIDDEN',
                                    canRead: ready,
                                    canWrite: ready,
                                    canConfigure: false,
                                },
                            ],
                        }}
                    >
                        <SeoEditorLink targetType={targetType} targetId="42" name="真实实体入口" />
                        <Location />
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
}
describe('discoverable native entity SEO actions', () => {
    it.each([
        ['PRODUCT', 'ReadProduct', 'products'],
        ['COLLECTION', 'ReadCollection', 'collections'],
    ] as const)(
        'opens the %s editor with only its native read permission',
        (targetType, permission, entity) => {
            render(targetType, [permission]);
            const action = container.querySelector<HTMLButtonElement>(
                'button[aria-label="搜索优化：真实实体入口"]',
            );
            expect(action).not.toBeNull();
            act(() => action!.click());
            expect(container.querySelector('output')?.textContent).toBe(
                `/catalog/${entity}/42/seo?languageCode=zh_Hans`,
            );
        },
    );
    it('hides the product action for a collection-only user', () => {
        render('PRODUCT', ['ReadCollection']);
        expect(container.querySelector('button')).toBeNull();
    });
    it('hides an action when its current-store capability is forbidden', () => {
        render('COLLECTION', ['ReadCollection'], false);
        expect(container.querySelector('button')).toBeNull();
    });
    it('lets the shared draft guard cancel navigation away from an existing editor', () => {
        render('PRODUCT', ['ReadProduct']);
        const cancel = (event: Event) => event.preventDefault();
        window.addEventListener(BEFORE_APP_NAVIGATION_EVENT, cancel);
        try {
            act(() => container.querySelector<HTMLButtonElement>('button')!.click());
            expect(container.querySelector('output')?.textContent).toBe('/catalog/products/42');
        } finally {
            window.removeEventListener(BEFORE_APP_NAVIGATION_EVENT, cancel);
        }
    });
});

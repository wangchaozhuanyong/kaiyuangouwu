// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import type { AdminCapabilitySnapshot } from '../../../common/src/admin-capabilities';
import { hasAnyAdminPermission } from '../utils/admin-permissions';
import { AdminCapabilitiesContext } from './use-admin-capabilities';
import { AdminPermissionsContext, useAdminPermissions } from './use-admin-permissions';

async function permissionsFor(path: string, snapshot: AdminCapabilitySnapshot) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    const root = createRoot(host);
    let result!: ReturnType<typeof useAdminPermissions>;
    function Probe() {
        const permissions = useAdminPermissions();
        useLayoutEffect(() => {
            result = permissions;
        }, [permissions]);
        return null;
    }
    await act(async () =>
        root.render(
            <AdminPermissionsContext.Provider
                value={{
                    permissions: ['SuperAdmin'],
                    hasAnyPermission: required => hasAnyAdminPermission(['SuperAdmin'], required),
                }}
            >
                <AdminCapabilitiesContext.Provider value={snapshot}>
                    <MemoryRouter initialEntries={[path]}>
                        <Probe />
                    </MemoryRouter>
                </AdminCapabilitiesContext.Provider>
            </AdminPermissionsContext.Provider>,
        ),
    );
    await act(async () => root.unmount());
    return result;
}

it('platform supervision can read orders but cannot expose their write operations', async () => {
    const result = await permissionsFor('/sales/orders/12', {
        channelId: 'platform',
        channelCode: '__default_channel__',
        scope: 'PLATFORM',
        commerceMode: null,
        capabilities: [
            { id: '/sales/orders', state: 'READY', canRead: true, canWrite: false, canConfigure: false },
        ],
    });
    expect(result.hasAnyPermission(['ReadOrder'])).toBe(true);
    expect(result.hasAnyPermission(['UpdateOrder'])).toBe(false);
    expect(result.hasAnyPermission(['CreateOrder'])).toBe(false);
});

it('a supported unconfigured setting keeps configuration permission without business access', async () => {
    const result = await permissionsFor('/plugins/ai-settings/config', {
        channelId: 'a',
        channelCode: 'a',
        scope: 'STORE',
        commerceMode: 'DIGITAL_ONLY',
        capabilities: [
            {
                id: '/plugins/ai-settings/config',
                state: 'NEEDS_CONFIGURATION',
                canRead: true,
                canWrite: false,
                canConfigure: true,
            },
        ],
    });
    expect(result.hasAnyPermission(['UpdateImageGeneration'])).toBe(true);
    expect(result.hasAnyPermission(['ReadImageGeneration'])).toBe(true);
});

it('the same administrator loses unsupported store business operations', async () => {
    const result = await permissionsFor('/catalog/purchase-orders', {
        channelId: 'a',
        channelCode: 'a',
        scope: 'STORE',
        commerceMode: 'DIGITAL_ONLY',
        capabilities: [
            {
                id: '/catalog/purchase-orders',
                state: 'UNSUPPORTED',
                canRead: false,
                canWrite: false,
                canConfigure: false,
            },
        ],
    });
    expect(result.hasAnyPermission(['ReadCatalogOperations'])).toBe(false);
    expect(result.hasAnyPermission(['UpdateCatalogOperations'])).toBe(false);
});

it('keeps the permission callback and result stable until capability or administrator permissions change', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    const root = createRoot(host);
    const initialPermissions = ['SuperAdmin'];
    const context = {
        permissions: initialPermissions,
        hasAnyPermission: (required: readonly string[]) =>
            hasAnyAdminPermission(initialPermissions, required),
    };
    const snapshot: AdminCapabilitySnapshot = {
        channelId: 'a',
        channelCode: 'a',
        scope: 'STORE',
        commerceMode: 'DIGITAL_ONLY',
        capabilities: [
            { id: '/catalog/products', state: 'READY', canRead: true, canWrite: true, canConfigure: true },
        ],
    };
    let result!: ReturnType<typeof useAdminPermissions>;
    function Probe({ revision }: { revision: number }) {
        const permissions = useAdminPermissions();
        useLayoutEffect(() => {
            result = permissions;
        }, [permissions]);
        return <span>{revision}</span>;
    }
    const render = async (revision: number, current = snapshot, permissions = context) =>
        act(async () =>
            root.render(
                <AdminPermissionsContext.Provider value={permissions}>
                    <AdminCapabilitiesContext.Provider value={current}>
                        <MemoryRouter initialEntries={['/catalog/products/11']}>
                            <Probe revision={revision} />
                        </MemoryRouter>
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>,
            ),
        );
    try {
        await render(0);
        const original = result;
        await render(1);
        expect(result).toBe(original);
        expect(result.hasAnyPermission).toBe(original.hasAnyPermission);
        expect(result.hasAnyPermission(['UpdateCatalog'])).toBe(true);
        await render(2, {
            ...snapshot,
            capabilities: snapshot.capabilities.map(item => ({
                ...item,
                canWrite: false,
                canConfigure: false,
            })),
        });
        expect(result).not.toBe(original);
        expect(result.hasAnyPermission(['ReadCatalog'])).toBe(true);
        expect(result.hasAnyPermission(['UpdateCatalog'])).toBe(false);
        await render(3, snapshot, { permissions: [], hasAnyPermission: required => required.length === 0 });
        expect(result.hasAnyPermission(['ReadCatalog'])).toBe(false);
    } finally {
        await act(async () => root.unmount());
    }
});

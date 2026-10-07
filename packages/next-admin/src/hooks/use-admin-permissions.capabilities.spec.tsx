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

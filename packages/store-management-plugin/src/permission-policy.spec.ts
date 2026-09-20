import { describe, expect, it } from 'vitest';

import {
    managePlatformTeamPermission,
    manageStoreLifecyclePermission,
    manageStoreTeamPermission,
    reviewStoreGovernancePermission,
    sensitiveStoreFinancePermission,
    storeProfilePermission,
} from './constants';
import { PermissionPolicyRegistry } from './permission-policy';

function registry() {
    return new PermissionPolicyRegistry({
        authOptions: {
            customPermissions: [
                storeProfilePermission,
                manageStoreTeamPermission,
                managePlatformTeamPermission,
                manageStoreLifecyclePermission,
                reviewStoreGovernancePermission,
                sensitiveStoreFinancePermission,
            ],
        },
    } as any);
}

describe('PermissionPolicyRegistry', () => {
    it('keeps owner-only, platform, and store permissions in fixed scopes', () => {
        const catalog = new Map(
            registry()
                .catalog()
                .map(item => [item.code, item]),
        );

        expect(catalog.get('SuperAdmin')).toMatchObject({ scope: 'OWNER_ONLY', delegable: false });
        expect(catalog.get('CreateApiKey')).toMatchObject({ scope: 'OWNER_ONLY', delegable: false });
        expect(catalog.get('CreateAdministrator')).toMatchObject({ scope: 'PLATFORM', delegable: false });
        expect(catalog.get('ManageStoreLifecycle')).toMatchObject({
            name: '管理店铺生命周期',
            scope: 'PLATFORM',
            delegable: true,
        });
        expect(catalog.get('ManageStoreTeam')).toMatchObject({ scope: 'STORE', delegable: false });
        expect(catalog.get('UpdateProduct')).toMatchObject({ scope: 'STORE', delegable: true });
    });

    it('rejects platform-only permissions from store roles', () => {
        expect(() => registry().assertStoreRolePermissions(['UpdateProduct'])).not.toThrow();
        expect(() => registry().assertStoreRolePermissions(['CreateApiKey'])).toThrow('平台专属');
        expect(() => registry().assertStoreRolePermissions(['CreateAdministrator'])).toThrow('不可下放');
    });

    it('publishes constrained store job templates without invalid permissions', () => {
        const templates = registry().templates();
        expect(templates.map(template => template.code)).toEqual(
            expect.arrayContaining([
                'STORE_MANAGER',
                'PRODUCT_OPERATIONS',
                'ORDER_FULFILLMENT',
                'CUSTOMER_SERVICE',
                'MARKETING_CONTENT',
                'FINANCE_VIEW',
            ]),
        );
        expect(templates.flatMap(template => template.permissions)).not.toContain('SuperAdmin');
        expect(templates.flatMap(template => template.permissions)).not.toContain('CreateApiKey');
    });

    it('adds available read dependencies when a write permission is selected', () => {
        expect(registry().normalizePermissions(['UpdateProduct'])).toEqual(
            expect.arrayContaining(['ReadProduct', 'UpdateProduct']),
        );
    });
});

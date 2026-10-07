import { describe, expect, it } from 'vitest';

import {
    ADMIN_CAPABILITY_DEFINITIONS,
    adminCapabilityAllows,
    adminCapabilityForPath,
    adminCapabilityScopeAllows,
    type AdminCapabilitySnapshot,
} from './admin-capabilities';

describe('store capability boundaries', () => {
    it('keeps unique definitions and gives create its own permission contract', () => {
        expect(new Set(ADMIN_CAPABILITY_DEFINITIONS.map(item => item.id)).size).toBe(
            ADMIN_CAPABILITY_DEFINITIONS.length,
        );
        expect(adminCapabilityForPath('/catalog/products/new')?.readPermissions).toEqual(['CreateProduct']);
        expect(adminCapabilityForPath('/catalog/products/42?tab=variants')?.id).toBe('/catalog/products');
    });
    it.each([
        '/settings/system-ops/settings',
        '/settings/system-ops/schedules',
        '/settings/system-ops/telegram',
        '/settings/usdt-payments/wallets',
        '/marketing/promotions/generic',
    ])('does not expose platform functionality in an operating store: %s', path => {
        const definition = adminCapabilityForPath(path);
        expect(adminCapabilityScopeAllows(definition, 'STORE', 'HYBRID')).toBe(false);
        expect(adminCapabilityScopeAllows(definition, 'PLATFORM', null)).toBe(true);
    });
    it('requires a known compatible mode without hiding suppliers or personal tools', () => {
        for (const path of [
            '/catalog/inventory/lots',
            '/catalog/purchase-orders',
            '/settings/store-profile/shipping',
        ]) {
            const definition = adminCapabilityForPath(path);
            expect(adminCapabilityScopeAllows(definition, 'STORE', 'DIGITAL_ONLY')).toBe(false);
            expect(adminCapabilityScopeAllows(definition, 'STORE', null)).toBe(false);
            expect(adminCapabilityScopeAllows(definition, 'STORE', 'PHYSICAL_ONLY')).toBe(true);
        }
        expect(
            adminCapabilityScopeAllows(adminCapabilityForPath('/catalog/suppliers'), 'STORE', 'DIGITAL_ONLY'),
        ).toBe(true);
        expect(
            adminCapabilityScopeAllows(adminCapabilityForPath('/plugins/two-factor-codes'), 'STORE', null),
        ).toBe(true);
        expect(
            adminCapabilityScopeAllows(
                adminCapabilityForPath('/catalog/card-pool/pool'),
                'STORE',
                'PHYSICAL_ONLY',
            ),
        ).toBe(false);
    });
    it('denies absent snapshots and unsupported records while retaining authorized configuration', () => {
        const snapshot: AdminCapabilitySnapshot = {
            channelId: 'a',
            channelCode: 'a',
            scope: 'STORE',
            commerceMode: 'HYBRID',
            capabilities: [
                {
                    id: 'config',
                    state: 'NEEDS_CONFIGURATION',
                    canRead: true,
                    canConfigure: true,
                    canWrite: false,
                },
                { id: 'hidden', state: 'UNSUPPORTED', canRead: true, canConfigure: true, canWrite: true },
            ],
        };
        expect(adminCapabilityAllows(null, 'config')).toBe(false);
        expect(adminCapabilityAllows(snapshot, 'unknown')).toBe(false);
        expect(adminCapabilityAllows(snapshot, 'hidden')).toBe(false);
        expect(adminCapabilityAllows(snapshot, 'config', 'configure')).toBe(true);
        expect(adminCapabilityAllows(snapshot, 'config', 'write')).toBe(false);
    });
});

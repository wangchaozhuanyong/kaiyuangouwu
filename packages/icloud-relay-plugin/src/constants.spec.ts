import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { manageIcloudRelayPermission } from './constants';

describe('iCloud relay permissions', () => {
    it('defines a dedicated assignable CRUD permission set for API-key roles', () => {
        expect(manageIcloudRelayPermission.Create).toBe('CreateIcloudRelay');
        expect(manageIcloudRelayPermission.Read).toBe('ReadIcloudRelay');
        expect(manageIcloudRelayPermission.Update).toBe('UpdateIcloudRelay');
        expect(manageIcloudRelayPermission.Delete).toBe('DeleteIcloudRelay');
        expect(manageIcloudRelayPermission.getMetadata()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'CreateIcloudRelay', assignable: true }),
                expect.objectContaining({ name: 'ReadIcloudRelay', assignable: true }),
                expect.objectContaining({ name: 'UpdateIcloudRelay', assignable: true }),
                expect.objectContaining({ name: 'DeleteIcloudRelay', assignable: true }),
            ]),
        );
    });

    it('uses the read permission for both current admin navigation implementations', () => {
        const dashboardRoute = readFileSync(new URL('./dashboard/index.tsx', import.meta.url), 'utf8');
        const nextAdminExtensions = readFileSync(
            new URL('../../next-admin/src/extensions/installed-extensions.tsx', import.meta.url),
            'utf8',
        );
        const resolver = readFileSync(new URL('./api/icloud-admin.resolver.ts', import.meta.url), 'utf8');

        expect(dashboardRoute).toContain("requiresPermission: ['ReadIcloudRelay']");
        expect(nextAdminExtensions).toMatch(/id: 'icloud-relay'[\s\S]*?permissions: \['ReadIcloudRelay'\]/);
        expect(resolver).toContain('@Allow(manageIcloudRelayPermission.Read)');
        expect(resolver).not.toContain('Permission.SuperAdmin');
    });
});

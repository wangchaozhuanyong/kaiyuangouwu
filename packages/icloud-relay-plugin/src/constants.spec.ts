import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

    it('preserves scoped API reads while NextAdmin reserves the private page for the platform owner', () => {
        const nextAdminExtensions = readFileSync(
            resolve(__dirname, '../../next-admin/src/extensions/installed-extensions.tsx'),
            'utf8',
        );
        const resolver = readFileSync(resolve(__dirname, 'api/icloud-admin.resolver.ts'), 'utf8');

        // Platform governance reserves this private UI for the owner; API-key CRUD stays scoped.
        expect(nextAdminExtensions).toMatch(/id: 'icloud-relay'[\s\S]*?permissions: \['SuperAdmin'\]/);
        expect(resolver).toContain('@Allow(manageIcloudRelayPermission.Read)');
        expect(resolver).not.toContain('Permission.SuperAdmin');
    });
});

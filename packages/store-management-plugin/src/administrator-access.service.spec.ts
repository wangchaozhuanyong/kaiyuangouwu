import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { AdministratorAccessService } from './administrator-access.service';

function service() {
    return new AdministratorAccessService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    ) as any;
}

function profile(
    id: string,
    scope: 'PLATFORM' | 'STORE',
    authority: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF',
    channelId: string | null = null,
) {
    return { id, scope, authority, channelId };
}

describe('AdministratorAccessService hierarchy policy', () => {
    it('allows the platform owner to create lower platform and store accounts only', () => {
        const access = service();
        const owner = profile('owner', 'PLATFORM', 'OWNER');

        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'ADMIN', null)).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'STAFF', null)).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'STORE', 'MANAGER', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'OWNER', null)).toThrow('专用转移');
        expect(() => access.assertCanCreate(owner, 'STORE', 'ADMIN', 'store-a')).toThrow('专用转移');
    });

    it('prevents platform administrators and company staff from creating peers or higher accounts', () => {
        const access = service();
        const platformAdmin = profile('platform-admin', 'PLATFORM', 'ADMIN');
        const companyManager = profile('company-manager', 'PLATFORM', 'MANAGER');
        const companyStaff = profile('company-staff', 'PLATFORM', 'STAFF');

        expect(() => access.assertCanCreate(platformAdmin, 'PLATFORM', 'MANAGER', null)).not.toThrow();
        expect(() => access.assertCanCreate(platformAdmin, 'STORE', 'STAFF', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(platformAdmin, 'PLATFORM', 'ADMIN', null)).toThrow('同级');
        expect(() => access.assertCanCreate(companyManager, 'STORE', 'STAFF', 'store-a')).toThrow();
        expect(() => access.assertCanCreate(companyStaff, 'PLATFORM', 'STAFF', null)).toThrow();
    });

    it('limits the store primary administrator to lower accounts in the same store', () => {
        const access = service();
        const primary = profile('store-primary', 'STORE', 'ADMIN', 'store-a');
        const storeManager = profile('store-manager', 'STORE', 'MANAGER', 'store-a');
        const storeStaff = profile('store-staff', 'STORE', 'STAFF', 'store-a');

        expect(() => access.assertCanCreate(primary, 'STORE', 'MANAGER', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(primary, 'STORE', 'STAFF', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(primary, 'STORE', 'STAFF', 'store-b')).toThrow();
        expect(() => access.assertCanCreate(primary, 'PLATFORM', 'STAFF', null)).toThrow();
        expect(() => access.assertCanCreate(storeManager, 'STORE', 'STAFF', 'store-a')).toThrow();
        expect(() => access.assertCanCreate(storeStaff, 'STORE', 'STAFF', 'store-a')).toThrow();
    });

    it('applies downward-only management and store boundaries', () => {
        const access = service();
        const owner = profile('owner', 'PLATFORM', 'OWNER');
        const platformAdmin = profile('platform-admin', 'PLATFORM', 'ADMIN');
        const companyStaff = profile('company-staff', 'PLATFORM', 'STAFF');
        const storePrimary = profile('store-primary', 'STORE', 'ADMIN', 'store-a');
        const storeStaff = profile('store-staff', 'STORE', 'STAFF', 'store-a');
        const otherStoreStaff = profile('other-store-staff', 'STORE', 'STAFF', 'store-b');

        expect(access.canManage(owner, platformAdmin, false)).toBe(true);
        expect(access.canManage(platformAdmin, owner, false)).toBe(false);
        expect(access.canManage(platformAdmin, companyStaff, false)).toBe(true);
        expect(access.canManage(platformAdmin, storePrimary, false)).toBe(true);
        expect(access.canManage(storePrimary, storeStaff, false)).toBe(true);
        expect(access.canManage(storePrimary, otherStoreStaff, false)).toBe(false);
        expect(access.canManage(storeStaff, companyStaff, false)).toBe(false);
    });
});

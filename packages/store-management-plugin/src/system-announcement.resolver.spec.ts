import 'reflect-metadata';

import { Permission } from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { describe, expect, it } from 'vitest';

import {
    SystemAnnouncementAdminResolver,
    SystemAnnouncementShopResolver,
} from './system-announcement.resolver';

describe('SystemAnnouncement resolver permissions', () => {
    it.each([
        ['systemAnnouncements', storefrontContentPermission.Read],
        ['createSystemAnnouncement', storefrontContentPermission.Create],
        ['updateSystemAnnouncement', storefrontContentPermission.Update],
        ['deleteSystemAnnouncement', storefrontContentPermission.Delete],
    ] as const)('allows the matching storefront content permission at %s', (method, permission) => {
        const handler = Object.getOwnPropertyDescriptor(
            SystemAnnouncementAdminResolver.prototype,
            method,
        )?.value;
        expect(Reflect.getMetadata('__permissions__', handler)).toEqual([Permission.SuperAdmin, permission]);
    });

    it('keeps storefront announcement reads public', () => {
        const handler = Object.getOwnPropertyDescriptor(
            SystemAnnouncementShopResolver.prototype,
            'activeSystemAnnouncements',
        )?.value;
        expect(Reflect.getMetadata('__permissions__', handler)).toEqual([Permission.Public]);
    });
});

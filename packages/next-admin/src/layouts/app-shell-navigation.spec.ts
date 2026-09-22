import { describe, expect, it } from 'vitest';

import {
    filterAccessibleAdminChannels,
    hasAppShellPermissionSnapshot,
    isAppShellPermissionLoading,
    isPlatformBusinessPath,
    isPlatformManagementChannel,
    resolveAppShellOpenMenu,
} from './app-shell-navigation';

describe('admin channel switcher', () => {
    it('only exposes channels assigned to the current administrator', () => {
        const channels = [
            { id: 'default', token: 'default-token' },
            { id: 'moyao', token: 'moyao-token' },
            { id: 'mjj', token: 'mjj-token' },
        ];

        expect(filterAccessibleAdminChannels(channels, [{ id: 'moyao' }])).toEqual([
            { id: 'moyao', token: 'moyao-token' },
        ]);
    });

    it('keeps every assigned channel for administrators with multi-store access', () => {
        const channels = [
            { id: 'default', token: 'default-token' },
            { id: 'moyao', token: 'moyao-token' },
            { id: 'mjj', token: 'mjj-token' },
        ];

        expect(filterAccessibleAdminChannels(channels, [{ id: 'default' }, { id: 'mjj' }])).toEqual([
            { id: 'default', token: 'default-token' },
            { id: 'mjj', token: 'mjj-token' },
        ]);
    });

    it('exposes every store to a SuperAdmin even when the session permission snapshot is stale', () => {
        const channels = [
            { id: 'default', token: 'default-token' },
            { id: 'moyao', token: 'moyao-token' },
            { id: 'mjj', token: 'mjj-token' },
        ];

        expect(filterAccessibleAdminChannels(channels, [{ id: 'default' }], true)).toEqual(channels);
    });
});

describe('app shell navigation', () => {
    it('treats the default Channel as platform management and blocks store business routes', () => {
        expect(isPlatformManagementChannel('__default_channel__')).toBe(true);
        expect(isPlatformManagementChannel('moyao-ai')).toBe(false);
        expect(isPlatformBusinessPath('/catalog/list')).toBe(true);
        expect(isPlatformBusinessPath('/sales/orders')).toBe(true);
        expect(isPlatformBusinessPath('/customers/list')).toBe(true);
        expect(isPlatformBusinessPath('/settings/team')).toBe(false);
        expect(isPlatformBusinessPath('/dashboard')).toBe(false);
    });

    it('keeps an extension in its registered menu even when its URL uses another section prefix', () => {
        expect(resolveAppShellOpenMenu('/storefront/business-services-copy', 'plugins')).toBe('plugins');
    });

    it.each([
        ['/catalog/list', 'catalog'],
        ['/sales/orders', 'sales'],
        ['/marketing/promotions', 'marketing'],
        ['/storefront/content', 'storefront'],
        ['/plugins/client-plugins', 'plugins'],
        ['/settings/team', 'settings'],
    ])('uses the built-in section for %s', (pathname, expected) => {
        expect(resolveAppShellOpenMenu(pathname)).toBe(expected);
    });

    it('collapses accordion menus on standalone pages without changing unknown routes', () => {
        expect(resolveAppShellOpenMenu('/dashboard')).toBeNull();
        expect(resolveAppShellOpenMenu('/customers/list')).toBeNull();
        expect(resolveAppShellOpenMenu('/profile')).toBeUndefined();
    });
});

describe('app shell permission snapshot', () => {
    it('accepts an empty permission list as a completed snapshot', () => {
        const snapshot = {
            activeChannel: { id: 'channel-1' },
            me: { channels: [{ id: 'channel-1', permissions: [] }] },
        };

        expect(hasAppShellPermissionSnapshot(snapshot)).toBe(true);
        expect(isAppShellPermissionLoading(snapshot, true)).toBe(false);
    });

    it('rejects missing or stale channel permission data', () => {
        expect(hasAppShellPermissionSnapshot()).toBe(false);
        expect(
            hasAppShellPermissionSnapshot({
                activeChannel: { id: 'channel-2' },
                me: { channels: [{ id: 'channel-1', permissions: ['ReadSettings'] }] },
            }),
        ).toBe(false);
        expect(isAppShellPermissionLoading(undefined, true)).toBe(true);
    });
});

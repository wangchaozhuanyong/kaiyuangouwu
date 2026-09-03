import { describe, expect, it } from 'vitest';

import {
    hasAppShellPermissionSnapshot,
    isAppShellPermissionLoading,
    resolveAppShellOpenMenu,
} from './app-shell-navigation';

describe('app shell navigation', () => {
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

import { NavMenuConfig, NavMenuItem } from '@vendure/dashboard';

const platformSettingsItemIds = new Set([
    'channels',
    'countries',
    'payment-methods',
    'shipping-methods',
    'zones',
]);

export function restrictPlatformNavigation(config: NavMenuConfig): NavMenuConfig {
    return {
        sections: config.sections.map(section => {
            if (section.id !== 'settings' || !('items' in section)) {
                return section;
            }
            return {
                ...section,
                items: section.items?.map(item =>
                    platformSettingsItemIds.has(item.id)
                        ? ({ ...item, requiresPermission: ['CreateChannel'] } as NavMenuItem)
                        : item,
                ),
            };
        }),
    };
}

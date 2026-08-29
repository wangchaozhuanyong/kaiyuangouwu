import { NavMenuConfig } from '@vendure/dashboard';

const platformSettingsItemIds = new Set([
    'channels',
    'countries',
    'payment-methods',
    'shipping-methods',
    'zones',
]);
const managedReplacementItemIds = new Set(['promotions']);

export function restrictPlatformNavigation(config: NavMenuConfig): NavMenuConfig {
    return {
        sections: config.sections.map(section => {
            if (!('items' in section)) {
                return section;
            }
            return {
                ...section,
                items: section.items?.map(item =>
                    platformSettingsItemIds.has(item.id) || managedReplacementItemIds.has(item.id)
                        ? { ...item, requiresPermission: ['CreateChannel'] }
                        : item,
                ),
            };
        }),
    };
}

import { ShopApiGraphQlError } from './helpers';

const fallbackFields = {
    optionalContentSettings: new Set([
        'StorefrontContentSettings.accountRecommendations',
        'StorefrontContentSettings.personalDataExportEnabled',
        'StorefrontSystemAnnouncement.createdAt',
    ]),
    content: new Set([
        'Query.activeStorefrontFlashSales',
        'Query.activeSystemAnnouncements',
        'StorefrontSystemAnnouncement.createdAt',
        'StorefrontContentSettings.auth',
        'StorefrontContentSettings.personalDataExportEnabled',
        'StorefrontContentSettings.accountRecommendations',
        'StorefrontContentSettings.configuredBlockTypes',
        'StorefrontContentBlock.internalName',
        'StorefrontContentBlock.layoutVariant',
        'StorefrontContentBlock.settings',
        'StorefrontContentItem.settings',
    ]),
    personalDataExport: new Set(['StorefrontContentSettings.personalDataExportEnabled']),
    announcementsCreatedAt: new Set(['StorefrontSystemAnnouncement.createdAt']),
    coupons: new Set(['Query.activeStorefrontCoupons']),
    provinces: new Set(['Query.availableStorefrontProvinces']),
    visualPreset: new Set(['Query.storefrontVisualPreset']),
    desktopLayout: new Set(['StorefrontVisualPreset.desktopLayout']),
};

/** Older servers can reject several new optional fields in the same validation response. */
export function unsupportedOptionalContentFields(error: unknown): Set<string> {
    if (!isSupportedContentSchemaFallback(error, 'optionalContentSettings')) return new Set();
    return new Set(
        (error as ShopApiGraphQlError).messages.flatMap(message => {
            const match = /^Cannot query field "([^"]+)" on type "([^"]+)"\./u.exec(message);
            return match ? [`${match[2]}.${match[1]}`] : [];
        }),
    );
}

/** Only downgrade fields omitted by the documented legacy query. */
export function isSupportedContentSchemaFallback(
    error: unknown,
    feature: keyof typeof fallbackFields,
): boolean {
    if (!(error instanceof ShopApiGraphQlError) || ![200, 400].includes(error.status)) return false;
    return (
        error.messages.length > 0 &&
        error.messages.every(message => {
            const match = /^Cannot query field "([^"]+)" on type "([^"]+)"\./u.exec(message);
            return !!match && fallbackFields[feature].has(`${match[2]}.${match[1]}`);
        })
    );
}

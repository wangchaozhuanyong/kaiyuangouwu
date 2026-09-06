import { ShopApiGraphQlError } from './helpers';

const fallbackFields = {
    content: new Set([
        'Query.activeStorefrontFlashSales',
        'Query.activeSystemAnnouncements',
        'StorefrontContentSettings.configuredBlockTypes',
        'StorefrontContentBlock.internalName',
        'StorefrontContentBlock.layoutVariant',
        'StorefrontContentBlock.settings',
        'StorefrontContentItem.settings',
    ]),
    coupons: new Set(['Query.activeStorefrontCoupons']),
    visualPreset: new Set(['Query.storefrontVisualPreset']),
    desktopLayout: new Set(['StorefrontVisualPreset.desktopLayout']),
};

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

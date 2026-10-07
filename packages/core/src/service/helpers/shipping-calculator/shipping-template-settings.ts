import { LanguageCode } from '@vendure/common/lib/generated-types';

export const PLATFORM_SHIPPING_TEMPLATES_KEY = 'shippingManagement.platformTemplates';
export const STORE_SHIPPING_METHODS_KEY = 'shippingManagement.storeMethods';

export type StoreShippingMethodSettings = {
    ownedIds: string[];
    disabledIds: string[];
    sourceCurrencyCodes: Record<string, string>;
    adoptedTemplateId?: string;
};
export type PlatformShippingTemplateSettings = {
    freeShippingId?: string;
    versions?: Array<{ id: string; version: number }>;
};

export function storeShippingMethodSettings(value: unknown): StoreShippingMethodSettings {
    const settings = value as Partial<StoreShippingMethodSettings> | null;
    const ids = (items: unknown) =>
        Array.isArray(items) ? [...new Set(items.filter((id): id is string => typeof id === 'string'))] : [];
    const sourceCurrencyCodes: Record<string, string> = {};
    for (const [id, currency] of Object.entries(settings?.sourceCurrencyCodes ?? {})) {
        if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) sourceCurrencyCodes[id] = currency;
    }
    return {
        ownedIds: ids(settings?.ownedIds),
        disabledIds: ids(settings?.disabledIds),
        sourceCurrencyCodes,
        ...(typeof settings?.adoptedTemplateId === 'string'
            ? { adoptedTemplateId: settings.adoptedTemplateId }
            : {}),
    };
}

export function platformShippingTemplateIds(value: PlatformShippingTemplateSettings | undefined): string[] {
    return platformShippingTemplateVersions(value).map(template => template.id);
}

export function platformShippingTemplateVersions(
    value: PlatformShippingTemplateSettings | undefined,
): Array<{ id: string; version: number }> {
    const versions = Array.isArray(value?.versions)
        ? value.versions.filter(
              item => typeof item?.id === 'string' && Number.isSafeInteger(item.version) && item.version > 0,
          )
        : [];
    if (value?.freeShippingId && !versions.some(template => template.id === value.freeShippingId))
        versions.push({ id: value.freeShippingId, version: 1 });
    return [...new Map(versions.map(template => [template.id, template])).values()];
}

/** The single platform template has no monetary threshold and uses each operating store's shipping zone. */
export const PLATFORM_SHIPPING_TEMPLATE_INPUTS = [
    { key: 'freeShippingId' as const, code: 'platform-free-shipping', name: '包邮' },
].map(template => ({
    key: template.key,
    input: {
        code: template.code,
        fulfillmentHandler: 'manual-fulfillment',
        checker: {
            code: 'store-shipping-zone-eligibility-checker',
            arguments: [
                { name: 'allowedCountryCodes', value: '' },
                { name: 'blockedPostalPrefixes', value: '' },
            ],
        },
        calculator: {
            code: 'default-shipping-calculator',
            arguments: [
                { name: 'rate', value: '0' },
                { name: 'taxRate', value: '0' },
                { name: 'includesTax', value: 'include' },
            ],
        },
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: template.name,
                description: '免运费配送，仅适用本店已配置配送区域，由经营店铺独立选择启用。',
            },
        ],
    },
}));

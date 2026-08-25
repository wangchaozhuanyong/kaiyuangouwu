export type RegisteredContentStorage = 'VENDURE_TRANSLATIONS' | 'CUSTOM_TRANSLATIONS' | 'LOCALIZED_COLUMNS';
export type RegisteredFieldFormat = 'TEXT' | 'HTML' | 'SLUG';

export interface RegisteredContentField {
    path: string;
    format: RegisteredFieldFormat;
    requiredForPublish: boolean;
}

export interface RegisteredContentDefinition {
    storage: RegisteredContentStorage;
    fields: RegisteredContentField[];
}

const text = (path: string, requiredForPublish = true): RegisteredContentField => ({
    path,
    format: 'TEXT',
    requiredForPublish,
});
const html = (path: string, requiredForPublish = false): RegisteredContentField => ({
    path,
    format: 'HTML',
    requiredForPublish,
});
const slug = (path: string): RegisteredContentField => ({ path, format: 'SLUG', requiredForPublish: true });

export const customerFacingContentRegistry = {
    Product: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), slug('slug'), html('description', true)],
    },
    ProductVariant: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    ProductOptionGroup: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    ProductOption: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    Collection: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), slug('slug'), html('description')],
    },
    Facet: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    FacetValue: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    Promotion: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), text('description', false)],
    },
    ShippingMethod: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), text('description', false)],
    },
    PaymentMethod: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), text('description', false)],
    },
    Country: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    Province: { storage: 'VENDURE_TRANSLATIONS', fields: [text('name')] },
    StoreProfile: {
        storage: 'LOCALIZED_COLUMNS',
        fields: [text('storefrontName'), text('description')],
    },
    SystemAnnouncement: {
        storage: 'LOCALIZED_COLUMNS',
        fields: [text('title'), text('content')],
    },
    StorefrontContentBlock: {
        storage: 'CUSTOM_TRANSLATIONS',
        fields: [text('title'), text('subtitle', false), html('body', false), text('ctaLabel', false)],
    },
    StorefrontContentItem: {
        storage: 'CUSTOM_TRANSLATIONS',
        fields: [text('label'), text('description', false)],
    },
    StorePromotionCampaign: {
        storage: 'VENDURE_TRANSLATIONS',
        fields: [text('name'), text('description', false)],
    },
    AutoCardConfig: {
        storage: 'LOCALIZED_COLUMNS',
        fields: [text('fieldLabels'), html('instructions')],
    },
    StorefrontReviewMerchantResponse: {
        storage: 'LOCALIZED_COLUMNS',
        fields: [text('merchantResponse')],
    },
    AfterSalesResolution: {
        storage: 'LOCALIZED_COLUMNS',
        fields: [text('resolution')],
    },
} as const satisfies Record<string, RegisteredContentDefinition>;

export type RegisteredContentType = keyof typeof customerFacingContentRegistry;

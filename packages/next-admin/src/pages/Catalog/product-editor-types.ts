import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import type {
    DigitalDeliveryMode,
    DigitalStockPolicy,
    FulfillmentType,
    RefundPolicy,
} from '../../graphql/commerce.graphql';
import { stockPolicyForDeliveryMode, trackInventoryForDigitalVariant } from '../../utils/commerce-mode';
import type { CollectionFilterValue } from '../../utils/product-collection-assignment';

export type ProductEditorTab = 'BASIC' | 'VARIANTS' | 'FACETS_COLLECTIONS';
export const PRODUCT_EDITOR_TABS = {
    basic: 'BASIC',
    variants: 'VARIANTS',
    attributes: 'FACETS_COLLECTIONS',
} as const;
export const SOURCE_LANGUAGE_CODE = 'zh_Hans';
export const LOOKUP_PAGE_SIZE = 30;
export const ASSET_PAGE_SIZE = 40;
export const PRODUCT_MANAGED_CUSTOM_FIELDS = [
    'fulfillmentType',
    'refundPolicy',
    'manualDeliverySlaMinutes',
] as const;

export interface ProductVariantState {
    id?: string;
    sku: string;
    name: string;
    price: string;
    stockOnHand: number | '';
    stockAllocated: number;
    enabled: boolean;
    digitalDeliveryMode: DigitalDeliveryMode;
    digitalStockPolicy: DigitalStockPolicy;
    autoCardAvailableStock?: number | null;
    optionIds: string[];
    isNew?: boolean;
}

export interface FacetValueItem {
    id: string;
    code: string;
    name: string;
}

export interface FacetItem {
    id: string;
    code: string;
    name: string;
    values: FacetValueItem[];
}

export interface AssetItem {
    id: string;
    name: string;
    preview: string;
    type: string;
    fileSize?: number;
}

export interface OptionGroupItem {
    id: string;
    name: string;
    code: string;
    productCount: number;
    options: Array<{ id: string; name: string; code: string }>;
}

export interface CollectionItem {
    id: string;
    name: string;
    slug: string;
    filters: CollectionFilterValue[];
}

export interface CatalogChannel {
    id: string;
    code: string;
    token: string;
    defaultCurrencyCode: string;
}

export interface ProductDetailRecord {
    id: string;
    enabled: boolean;
    name: string;
    slug: string;
    description: string;
    customFields?:
        | ({
              fulfillmentType?: FulfillmentType | null;
              refundPolicy?: RefundPolicy | null;
              manualDeliverySlaMinutes?: number | null;
          } & Record<string, unknown>)
        | null;
    featuredAsset?: { id: string; preview: string; name: string } | null;
    assets: Array<{ id: string; name: string; preview: string }>;
    translations: Array<{
        id: string;
        languageCode: string;
        name: string;
        slug: string;
        description: string;
        customFields?: Record<string, unknown> | null;
    }>;
    optionGroups: Array<{ id: string }>;
    facetValues: Array<{ id: string }>;
    collections: CollectionItem[];
    channels: Array<{ id: string; code: string }>;
    variants: Array<{
        id: string;
        enabled: boolean;
        name: string;
        sku: string;
        price: number;
        stockOnHand: number;
        stockAllocated: number;
        trackInventory: string;
        autoCardAvailableStock?: number | null;
        customFields?: {
            fulfillmentType?: FulfillmentType | null;
            digitalDeliveryMode?: DigitalDeliveryMode | null;
            digitalStockPolicy?: DigitalStockPolicy | null;
        } | null;
        options: Array<{ id: string }>;
        translations: Array<{
            languageCode: string;
            name: string;
        }>;
    }>;
}

export interface ProductEditorSnapshotInput {
    productName: string;
    slug: string;
    enabled: boolean;
    description: string;
    fulfillmentType: FulfillmentType;
    refundPolicy: RefundPolicy;
    manualDeliverySlaMinutes: number;
    featuredAssetId: string | null;
    selectedAssetIds: string[];
    selectedFacetValueIds: string[];
    selectedCollectionIds: string[];
    selectedChannelIds: string[];
    selectedOptionGroupIds: string[];
    variants: ProductVariantState[];
    dynamicCustomFields: CustomFieldValueMap;
}

export const serializeProductEditor = (input: ProductEditorSnapshotInput) =>
    JSON.stringify({
        ...input,
        selectedAssetIds: [...input.selectedAssetIds].sort(),
        selectedFacetValueIds: [...input.selectedFacetValueIds].sort(),
        selectedCollectionIds: [...input.selectedCollectionIds].sort(),
        selectedChannelIds: [...input.selectedChannelIds].sort(),
        selectedOptionGroupIds: [...input.selectedOptionGroupIds].sort(),
        variants: input.variants.map(variant => ({
            id: variant.id ?? null,
            sku: variant.sku,
            name: variant.name,
            price: variant.price,
            stockOnHand: variant.stockOnHand,
            stockAllocated: variant.stockAllocated,
            enabled: variant.enabled,
            digitalDeliveryMode: variant.digitalDeliveryMode,
            digitalStockPolicy: variant.digitalStockPolicy,
            optionIds: [...variant.optionIds].sort(),
            isNew: Boolean(variant.isNew),
        })),
    });

export const createSlugFromName = (value: string) => {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `product-${Date.now().toString(36)}`;
};

export const variantFulfillmentInput = (variant: ProductVariantState, fulfillmentType: FulfillmentType) => {
    if (fulfillmentType === 'physical') {
        return {
            stockOnHand: variant.stockOnHand === '' ? 0 : Number(variant.stockOnHand),
            trackInventory: 'INHERIT' as const,
            customFields: {
                digitalStockPolicy: 'limited' as const,
            },
        };
    }
    const digitalStockPolicy = stockPolicyForDeliveryMode(
        variant.digitalDeliveryMode,
        variant.digitalStockPolicy,
    );
    return {
        stockOnHand:
            variant.digitalDeliveryMode === 'auto_card' || digitalStockPolicy === 'unlimited'
                ? 0
                : variant.stockOnHand === ''
                  ? 0
                  : Number(variant.stockOnHand),
        trackInventory: trackInventoryForDigitalVariant(variant.digitalDeliveryMode, digitalStockPolicy),
        customFields: {
            digitalDeliveryMode: variant.digitalDeliveryMode,
            digitalStockPolicy,
        },
    };
};

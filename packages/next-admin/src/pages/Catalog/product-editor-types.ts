import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import type {
    DigitalDeliveryMode,
    DigitalStockPolicy,
    FulfillmentType,
    RefundPolicy,
} from '../../graphql/commerce.graphql';
import { stockPolicyForDeliveryMode, trackInventoryForDigitalVariant } from '../../utils/commerce-mode';
import type { CollectionFilterValue } from '../../utils/product-collection-assignment';

export type ProductEditorTab = 'BASIC' | 'VARIANTS' | 'DELIVERY' | 'MORE' | 'FACETS_COLLECTIONS';
export const PRODUCT_EDITOR_TABS = {
    basic: 'BASIC',
    variants: 'VARIANTS',
    delivery: 'DELIVERY',
    more: 'MORE',
    attributes: 'FACETS_COLLECTIONS',
} as const;
export const SOURCE_LANGUAGE_CODE = 'zh_Hans';
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
    costPrice?: string;
    supplierId?: string | null;
    stockOnHand: number | '';
    stockAllocated: number;
    enabled: boolean;
    digitalDeliveryMode: DigitalDeliveryMode;
    digitalStockPolicy: DigitalStockPolicy;
    physicalSettings?: { packageQuantity?: number; shelfLifeDays?: number | null };
    digitalAvailableQuantity?: number;
    digitalFileVersionId?: string | null;
    digitalFileName?: string;
    digitalMigrationRequired?: boolean;
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
    productCount?: number;
    options: Array<{ id: string; name: string; code: string }>;
}

export interface CollectionItem {
    id: string;
    name: string;
    slug: string;
    position?: number;
    filters: CollectionFilterValue[];
    children?: CollectionItem[];
}

export interface CatalogChannel {
    id: string;
    code: string;
    token: string;
    defaultCurrencyCode: string;
    customFields?: { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | null;
}

export interface ProductDetailRecord {
    id: string;
    createdAt: string;
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
    optionGroups: OptionGroupItem[];
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
            physicalSettings: variant.physicalSettings,
            costPrice: variant.costPrice?.trim()
                ? Number.isFinite(Math.round(Number(variant.costPrice) * 1_000))
                    ? Math.round(Number(variant.costPrice) * 1_000)
                    : variant.costPrice.trim()
                : null,
            supplierId: variant.supplierId ?? null,
            digitalAvailableQuantity:
                variant.digitalStockPolicy === 'limited'
                    ? (variant.digitalAvailableQuantity ?? 0)
                    : undefined,
            digitalFileVersionId: variant.digitalFileVersionId ?? null,
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
            trackInventory: 'INHERIT' as const,
        };
    }
    const digitalStockPolicy = stockPolicyForDeliveryMode(
        variant.digitalDeliveryMode,
        variant.digitalStockPolicy,
    );
    return {
        trackInventory: trackInventoryForDigitalVariant(variant.digitalDeliveryMode, digitalStockPolicy),
    };
};

export type ProductEditorFormErrors = {
    name?: string;
    description?: string;
    variants?: Record<number, { sku?: string; price?: string; stock?: string }>;
};

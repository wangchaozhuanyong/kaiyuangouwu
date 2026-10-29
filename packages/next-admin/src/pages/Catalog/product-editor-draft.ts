import { customFieldValuesFromEntity } from '../../custom-fields/custom-field-utils';
import { type FulfillmentType } from '../../graphql/commerce.graphql';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import { getLocalizedEntityTranslation } from '../../utils/localized-entity-display';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import {
    serializeProductEditor,
    SOURCE_LANGUAGE_CODE,
    type CollectionItem,
    type ProductDetailRecord,
    type ProductVariantState,
} from './product-editor-types';

type ProductEditorDraft = Parameters<typeof serializeProductEditor>[0];
export type CreatedProductSavedDomain = 'prices' | 'details' | 'digital' | 'physical' | 'supplier' | 'cost';
interface CreatedProductDraftRecovery {
    draft: ProductEditorDraft;
    createdVariants: Array<{ id: string; sku: string }>;
    savedDomains: Record<string, CreatedProductSavedDomain[]>;
    attemptedDigitalQuantityIds: string[];
}
// This is a one-use handoff of an unsaved form, never a server-data cache or persistent storage.
const createdProductDrafts = new Map<string, CreatedProductDraftRecovery>();
const recoveryKey = (scope: string, productId: string) => JSON.stringify([scope, productId]);

export function retainCreatedProductDraft(
    scope: string,
    productId: string,
    draft: ProductEditorDraft,
    createdVariants: CreatedProductDraftRecovery['createdVariants'],
    savedDomains: CreatedProductDraftRecovery['savedDomains'] = {},
    attemptedDigitalQuantityIds: string[] = [],
) {
    createdProductDrafts.set(
        recoveryKey(scope, productId),
        structuredClone({ draft, createdVariants, savedDomains, attemptedDigitalQuantityIds }),
    );
}

export const hasCreatedProductDraft = (scope: string, productId: string) =>
    createdProductDrafts.has(recoveryKey(scope, productId));

export function takeCreatedProductDraft(scope: string, productId: string) {
    const key = recoveryKey(scope, productId);
    const recovery = createdProductDrafts.get(key);
    if (recovery) createdProductDrafts.delete(key);
    return recovery;
}

/** Match committed SKU identities before restoring settings that later create stages could not save. */
export function restoreCreatedProductDraft(
    recovery: CreatedProductDraftRecovery,
    baseline: ProductEditorDraft,
): ProductEditorDraft {
    const restoredVariants = recovery.draft.variants.map(variant => {
        const confirmed = recovery.createdVariants.find(item => item.sku === variant.sku.trim());
        const saved = baseline.variants.find(item =>
            variant.id || confirmed?.id
                ? item.id === (variant.id ?? confirmed?.id)
                : item.sku.trim() === variant.sku.trim(),
        );
        const restored = {
            ...variant,
            id: saved?.id ?? confirmed?.id,
            isNew: !saved?.id && !confirmed?.id,
            ...(saved
                ? {
                      sku: saved.sku,
                      name: saved.name,
                      price: saved.price,
                      enabled: saved.enabled,
                      optionIds: saved.optionIds,
                      variantCustomFields: saved.variantCustomFields,
                      stockOnHand: saved.stockOnHand,
                      stockAllocated: saved.stockAllocated,
                      digitalMigrationRequired: saved.digitalMigrationRequired,
                      inventorySummary: saved.inventorySummary,
                  }
                : {}),
        };
        if (saved?.id) {
            // A rejected response does not prove the stock write failed. Never replay the old quantity.
            if (recovery.attemptedDigitalQuantityIds.includes(saved.id)) {
                restored.digitalAvailableQuantity = saved.digitalAvailableQuantity;
            }
            const savedFields: Record<CreatedProductSavedDomain, ReadonlyArray<keyof ProductVariantState>> = {
                prices: ['currencyPrices'],
                details: ['variantCustomFields'],
                digital: [
                    'digitalDeliveryMode',
                    'digitalStockPolicy',
                    'digitalAvailableQuantity',
                    'digitalFileVersionId',
                    'digitalFileName',
                ],
                physical: ['physicalSettings'],
                supplier: ['supplierId'],
                cost: ['costPrice'],
            };
            for (const domain of recovery.savedDomains[saved.id] ?? []) {
                for (const field of savedFields[domain]) Object.assign(restored, { [field]: saved[field] });
            }
        }
        return restored;
    });
    const matchedIds = new Set(restoredVariants.map(variant => variant.id).filter(Boolean));
    return {
        // The product itself was already committed in stage 1; respect normalized source values.
        ...baseline,
        dynamicCustomFields: recovery.draft.dynamicCustomFields,
        selectedCollectionIds: recovery.draft.selectedCollectionIds,
        selectedChannelIds: recovery.draft.selectedChannelIds,
        selectedOptionGroupIds: recovery.draft.selectedOptionGroupIds,
        variants: [...restoredVariants, ...baseline.variants.filter(variant => !matchedIds.has(variant.id))],
    };
}

const digitalDraftFields = [
    'digitalDeliveryMode',
    'digitalStockPolicy',
    'digitalAvailableQuantity',
    'digitalFileVersionId',
    'digitalFileName',
] as const;

export function hasPendingDigitalDeliveryDraft(
    variant: ProductVariantState,
    baseline: ProductVariantState | undefined,
): boolean {
    if (
        !variant.id ||
        !baseline ||
        baseline.id !== variant.id ||
        !variant.digitalMigrationRequired ||
        !baseline.digitalMigrationRequired
    )
        return false;
    return digitalDraftFields.some(field => variant[field] !== baseline[field]);
}

/** A deliberate local undo never updates inventory or replaces unrelated product input. */
export function revertPendingDigitalDeliveryDraft(
    variant: ProductVariantState,
    baseline: ProductVariantState | undefined,
): ProductVariantState {
    if (!hasPendingDigitalDeliveryDraft(variant, baseline) || !baseline) return variant;
    const restored = { ...variant };
    for (const field of digitalDraftFields) Object.assign(restored, { [field]: baseline[field] });
    return restored;
}

export function productEditorDraft(
    product: ProductDetailRecord,
    fixedFulfillmentType: FulfillmentType | null,
    productExtensionFields: Parameters<typeof customFieldValuesFromEntity>[0],
    workspaceVariants?: Array<
        | {
              id: string;
              purchaseCostMicrounits?: number | null;
              packageQuantity?: number;
              shelfLifeDays?: number | null;
              supplier?: { id: string; name: string } | null;
          }
        | DigitalWorkspaceVariant
    >,
    variantExtensionFields: Parameters<typeof customFieldValuesFromEntity>[0] = [],
    collectionLookups?: CollectionItem[],
): Parameters<typeof serializeProductEditor>[0] {
    // Rules are saved before the asynchronous calculation updates Product.collections.
    // Prefer the current rule lookup, retaining known memberships if lookup data is unavailable.
    const configuredCollections = new Map(
        [
            ...product.collections,
            ...(collectionLookups?.flatMap(collection => [collection, ...(collection.children ?? [])]) ?? []),
        ].map(collection => [collection.id, collection]),
    );
    const sourceTranslation = getLocalizedEntityTranslation(product.translations, SOURCE_LANGUAGE_CODE);
    const fulfillmentType =
        fixedFulfillmentType ??
        (product.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital');
    const visibleVariants =
        fulfillmentType === 'digital'
            ? product.variants.filter(variant =>
                  workspaceVariants?.some(workspace => workspace.id === variant.id),
              )
            : product.variants;
    return {
        productName: sourceTranslation?.name ?? '',
        slug: sourceTranslation?.slug || product.slug || '',
        enabled: product.enabled,
        description: sourceTranslation?.description ?? '',
        fulfillmentType,
        refundPolicy:
            product.customFields?.refundPolicy === 'SEVEN_DAY_NO_REASON' ||
            product.customFields?.refundPolicy === 'NON_REFUNDABLE'
                ? product.customFields.refundPolicy
                : 'MERCHANT_REVIEW',
        manualDeliverySlaMinutes: Math.min(
            525600,
            Math.max(5, product.customFields?.manualDeliverySlaMinutes ?? 1440),
        ),
        featuredAssetId: product.featuredAsset?.id ?? null,
        selectedAssetIds: product.assets.map(asset => asset.id),
        selectedFacetValueIds: product.facetValues.map(value => value.id),
        selectedCollectionIds: [...configuredCollections.values()]
            .filter(collection => hasDirectProductAssignment(collection.filters, product.id))
            .map(collection => collection.id),
        selectedChannelIds: product.channels.map(channel => channel.id),
        selectedOptionGroupIds: product.optionGroups.map(group => group.id),
        variants: visibleVariants.map(variant => {
            const wsVariant = workspaceVariants?.find(w => w.id === variant.id);
            const costPrice =
                wsVariant?.purchaseCostMicrounits != null
                    ? (wsVariant.purchaseCostMicrounits / 1_000).toFixed(2)
                    : '';
            return {
                id: variant.id,
                sku: variant.sku || '',
                name:
                    getLocalizedEntityTranslation(variant.translations, SOURCE_LANGUAGE_CODE)?.name ??
                    sourceTranslation?.name ??
                    '',
                price: variant.price == null ? '' : (variant.price / 100).toFixed(2),
                ...(variant.prices
                    ? {
                          currencyPrices: Object.fromEntries(
                              variant.prices
                                  .filter(price => price.currencyCode !== variant.currencyCode)
                                  .map(price => [price.currencyCode, (price.price / 100).toFixed(2)]),
                          ),
                      }
                    : {}),
                ...(variantExtensionFields.length
                    ? {
                          variantCustomFields: customFieldValuesFromEntity(
                              variantExtensionFields,
                              variant.customFields,
                              variant.translations,
                          ),
                      }
                    : {}),
                costPrice,
                supplierId: wsVariant?.supplier?.id ?? null,
                physicalSettings:
                    wsVariant && 'packageQuantity' in wsVariant
                        ? {
                              packageQuantity: wsVariant.packageQuantity,
                              shelfLifeDays: wsVariant.shelfLifeDays,
                          }
                        : undefined,
                stockOnHand: variant.stockOnHand,
                stockAllocated: variant.stockAllocated,
                enabled: variant.enabled,
                digitalDeliveryMode:
                    variant.customFields?.digitalDeliveryMode === 'auto_card' ||
                    variant.customFields?.digitalDeliveryMode === 'file_download'
                        ? variant.customFields.digitalDeliveryMode
                        : 'manual_service',
                digitalStockPolicy:
                    variant.customFields?.digitalStockPolicy === 'pool_derived' ||
                    variant.customFields?.digitalStockPolicy === 'unlimited'
                        ? variant.customFields.digitalStockPolicy
                        : 'limited',
                ...(wsVariant && 'deliveryMode' in wsVariant
                    ? {
                          digitalDeliveryMode: wsVariant.deliveryMode,
                          digitalStockPolicy: wsVariant.stockPolicy,
                          digitalAvailableQuantity: wsVariant.availableQuantity ?? 0,
                          digitalMigrationRequired: wsVariant.migrationRequired,
                          digitalFileVersionId: wsVariant.fileVersion?.id ?? null,
                          digitalFileName: wsVariant.fileVersion?.fileName,
                          inventorySummary: wsVariant.inventory,
                      }
                    : {}),
                autoCardAvailableStock: variant.autoCardAvailableStock,
                optionIds: variant.options.map(option => option.id),
                isNew: false,
            };
        }),
        dynamicCustomFields: customFieldValuesFromEntity(
            productExtensionFields,
            product.customFields,
            product.translations,
        ),
    };
}

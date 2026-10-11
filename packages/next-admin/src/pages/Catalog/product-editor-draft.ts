import { customFieldValuesFromEntity } from '../../custom-fields/custom-field-utils';
import { type FulfillmentType } from '../../graphql/commerce.graphql';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import { getLocalizedEntityTranslation } from '../../utils/localized-entity-display';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import {
    serializeProductEditor,
    SOURCE_LANGUAGE_CODE,
    type ProductDetailRecord,
    type ProductVariantState,
} from './product-editor-types';

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
): Parameters<typeof serializeProductEditor>[0] {
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
        selectedCollectionIds: product.collections
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
                price: (variant.price / 100).toFixed(2),
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

import { customFieldValuesFromEntity } from '../../custom-fields/custom-field-utils';
import { type FulfillmentType } from '../../graphql/commerce.graphql';
import { hasDirectProductAssignment } from '../../utils/product-collection-assignment';
import {
    serializeProductEditor,
    SOURCE_LANGUAGE_CODE,
    type ProductDetailRecord,
} from './product-editor-types';

export function productEditorDraft(
    product: ProductDetailRecord,
    fixedFulfillmentType: FulfillmentType | null,
    productExtensionFields: Parameters<typeof customFieldValuesFromEntity>[0],
): Parameters<typeof serializeProductEditor>[0] {
    const sourceTranslation =
        product.translations.find(translation => translation.languageCode === SOURCE_LANGUAGE_CODE) ??
        product.translations[0];
    return {
        productName: sourceTranslation?.name || product.name || '',
        slug: sourceTranslation?.slug || product.slug || '',
        enabled: product.enabled,
        description: sourceTranslation?.description || product.description || '',
        fulfillmentType:
            fixedFulfillmentType ??
            (product.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital'),
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
        variants: product.variants.map(variant => ({
            id: variant.id,
            sku: variant.sku || '',
            name:
                variant.translations.find(translation => translation.languageCode === SOURCE_LANGUAGE_CODE)
                    ?.name ||
                variant.name ||
                sourceTranslation?.name ||
                product.name ||
                '',
            price: (variant.price / 100).toFixed(2),
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
            autoCardAvailableStock: variant.autoCardAvailableStock,
            optionIds: variant.options.map(option => option.id),
            isNew: false,
        })),
        dynamicCustomFields: customFieldValuesFromEntity(
            productExtensionFields,
            product.customFields,
            product.translations,
        ),
    };
}

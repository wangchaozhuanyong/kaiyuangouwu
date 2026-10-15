import { gql } from '@apollo/client';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
import { useAdminQuery } from '../../hooks/use-admin-query';
import type { ProductEditorFormState } from './useProductEditorForm';

const MANAGED_OFFER = gql`
    query ProductEditorManagedOffer($productId: ID!) {
        myProductSalesOffer(productId: $productId)
    }
`;

export function useProductMaintenanceScope(editor: ProductEditorFormState) {
    const offerRequired =
        !editor.isCreateMode &&
        Boolean(editor.productData?.product?.id) &&
        Boolean(editor.channelData?.activeChannel.code) &&
        editor.channelData?.activeChannel.code !== '__default_channel__';
    const managedOffer = useAdminQuery<{ myProductSalesOffer: { managedBy?: string | null } | null }>(
        MANAGED_OFFER,
        {
            variables: { productId: editor.productData?.product?.id ?? '' },
            skip: !offerRequired,
        },
    );
    const managedBy = managedOffer.data?.myProductSalesOffer?.managedBy;
    const sourceReadOnly =
        offerRequired && (Boolean(managedBy) || !managedOffer.data || Boolean(managedOffer.error));
    const { canUseCapability } = useAdminCapabilities();
    const canWriteProduct =
        !sourceReadOnly &&
        canUseCapability(editor.isCreateMode ? '/catalog/products/new' : '/catalog/products', 'write');
    const storedType = editor.productData?.product?.customFields?.fulfillmentType;
    const legacyTypeMismatch = Boolean(
        !editor.isCreateMode &&
        storedType &&
        editor.fixedFulfillmentType &&
        storedType !== editor.fixedFulfillmentType,
    );
    return { offerRequired, managedOffer, managedBy, sourceReadOnly, canWriteProduct, legacyTypeMismatch };
}

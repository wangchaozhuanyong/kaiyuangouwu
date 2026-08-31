import { gql } from '@apollo/client';

export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
export type FulfillmentType = 'digital' | 'physical';
export type RefundPolicy = 'MERCHANT_REVIEW' | 'SEVEN_DAY_NO_REASON' | 'NON_REFUNDABLE';
export type DigitalDeliveryMode = 'auto_card' | 'manual_service' | 'file_download';
export type DigitalStockPolicy = 'pool_derived' | 'limited' | 'unlimited';

export interface StoreCommerceModeData {
    myStoreCommerceMode: {
        mode: StoreCommerceMode;
        conflicts: Array<{
            code: string;
            message: string;
            entityId: string;
        }>;
    };
}

export const STORE_COMMERCE_MODE_QUERY = gql`
    query NextAdminStoreCommerceMode {
        myStoreCommerceMode {
            mode
            conflicts {
                code
                message
                entityId
            }
        }
    }
`;

export const UPDATE_STORE_COMMERCE_MODE_MUTATION = gql`
    mutation NextAdminUpdateStoreCommerceMode($mode: StoreCommerceMode!) {
        updateMyStoreCommerceMode(mode: $mode) {
            mode
            conflicts {
                code
                message
                entityId
            }
        }
    }
`;

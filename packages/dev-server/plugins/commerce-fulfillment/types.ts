import {
    CustomOrderLineFields,
    CustomProductVariantFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

export type FulfillmentType = 'physical' | 'digital';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductVariantFields {
        fulfillmentType: FulfillmentType;
    }

    interface CustomOrderLineFields {
        fulfillmentTypeSnapshot: FulfillmentType;
    }
}

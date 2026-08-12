import { gql } from 'graphql-tag';

export const shopApiExtensions = gql`
    enum CheckoutFulfillmentType {
        PHYSICAL
        DIGITAL
        MIXED
    }

    type CheckoutFulfillmentSummary {
        fulfillmentType: CheckoutFulfillmentType!
        containsPhysicalProducts: Boolean!
        containsDigitalProducts: Boolean!
        requiresShippingAddress: Boolean!
        requiresShippingMethod: Boolean!
    }

    extend type Order {
        checkoutFulfillment: CheckoutFulfillmentSummary!
    }
`;

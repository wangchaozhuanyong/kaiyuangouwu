import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';
import { createAdminCache } from './admin-cache';

describe('shared admin entity cache', () => {
    it('keeps list fields when the detail selects fewer custom fields, and accepts explicit nulls', () => {
        const cache = createAdminCache();
        const list = gql`
            query List {
                products {
                    items {
                        id
                        customFields {
                            pricingMode
                            fulfillmentType
                        }
                    }
                }
            }
        `;
        const detail = gql`
            query Detail {
                product {
                    id
                    customFields {
                        fulfillmentType
                    }
                }
            }
        `;
        cache.writeQuery({
            query: list,
            data: {
                products: {
                    items: [
                        {
                            __typename: 'Product',
                            id: '1',
                            customFields: {
                                __typename: 'ProductCustomFields',
                                pricingMode: 'FIXED',
                                fulfillmentType: 'physical',
                            },
                        },
                    ],
                },
            },
        });
        cache.writeQuery({
            query: detail,
            data: {
                product: {
                    __typename: 'Product',
                    id: '1',
                    customFields: { __typename: 'ProductCustomFields', fulfillmentType: null },
                },
            },
        });
        const result = cache.readQuery<any>({ query: list });
        expect(result.products.items[0].customFields).toMatchObject({
            pricingMode: 'FIXED',
            fulfillmentType: null,
        });
    });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digitalVariantMigrationInput, orderNeedsPaidMigrationReview } from './migrate-commerce-mode.mjs';

describe('commerce mode migration review', () => {
    it('does not block an unpaid draft order', () => {
        assert.equal(orderNeedsPaidMigrationReview({ state: 'Draft', payments: [] }), false);
    });

    it('blocks authorized and settled unfinished orders', () => {
        assert.equal(
            orderNeedsPaidMigrationReview({
                state: 'PaymentAuthorized',
                payments: [{ state: 'Authorized' }],
            }),
            true,
        );
        assert.equal(
            orderNeedsPaidMigrationReview({ state: 'Shipped', payments: [{ state: 'Settled' }] }),
            true,
        );
    });

    it('does not block terminal orders', () => {
        assert.equal(
            orderNeedsPaidMigrationReview({ state: 'Delivered', payments: [{ state: 'Settled' }] }),
            false,
        );
        assert.equal(
            orderNeedsPaidMigrationReview({ state: 'Cancelled', payments: [{ state: 'Authorized' }] }),
            false,
        );
    });
});

describe('commerce mode variant migration input', () => {
    it('does not send the read-only fulfillment type mirror to Admin GraphQL', () => {
        const input = digitalVariantMigrationInput({
            id: 'variant-1',
            customFields: {
                fulfillmentType: 'physical',
                digitalDeliveryMode: 'file_download',
                digitalStockPolicy: 'limited',
            },
        });

        assert.deepEqual(input, {
            id: 'variant-1',
            trackInventory: 'FALSE',
            customFields: {
                digitalDeliveryMode: 'file_download',
                digitalStockPolicy: 'unlimited',
            },
        });
        assert.equal(Object.hasOwn(input.customFields, 'fulfillmentType'), false);
    });
});

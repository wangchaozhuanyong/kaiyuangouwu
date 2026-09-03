import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { TestOrderItemPriceCalculationStrategy } from './fixtures/test-order-item-price-calculation-strategy';
import { ResultOf as AdminResultOf } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import { getProductWithVariantsDocument } from './graphql/shared-definitions';
import {
    addItemToOrderCustomFieldsDocument,
    adjustOrderLineCustomFieldsDocument,
    orderWithLinesAndItemsFragment,
} from './graphql/shop-definitions';

describe('custom OrderItemPriceCalculationStrategy', () => {
    let variants: NonNullable<AdminResultOf<typeof getProductWithVariantsDocument>['product']>['variants'];
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                OrderLine: [{ name: 'giftWrap', type: 'boolean' }],
            },
            orderOptions: {
                orderItemPriceCalculationStrategy: new TestOrderItemPriceCalculationStrategy(),
            },
        }),
    );

    type OrderWithLinesAndItems = FragmentOf<typeof orderWithLinesAndItemsFragment>;
    const orderGuard: ErrorResultGuard<OrderWithLinesAndItems> = createErrorResultGuard(
        input => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            slug: 'laptop',
        });
        if (!product) {
            throw new Error('Expected the imported laptop product');
        }
        variants = product.variants;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let secondOrderLineId: string;

    it('does not add surcharge', async () => {
        const variant0 = variants[0];
        const variantPrice = variant0.price;

        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variant0.id,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
    });

    it('adds a surcharge', async () => {
        const variant0 = variants[0];
        const variantPrice = variant0.price;

        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variant0.id,
            quantity: 1,
            customFields: {
                giftWrap: true,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
        expect(addItemToOrder.lines[1].unitPrice).toEqual(variantPrice + 500);
        expect(addItemToOrder.subTotal).toEqual(variantPrice + variantPrice + 500);
        secondOrderLineId = addItemToOrder.lines[1].id;
    });

    it('re-calculates when customFields changes', async () => {
        const variantPrice = variants[0].price;

        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[0].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + variantPrice);
    });

    it('applies discount for quantity greater than 3', async () => {
        const variantPrice = variants[0].price;

        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 4,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice / 2);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + (variantPrice / 2) * 4);
    });
});

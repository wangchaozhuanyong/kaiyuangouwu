import {
    Collection,
    PluginCommonModule,
    ProductVariant,
    RequestContextCacheService,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
    mergeConfig,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { collectionPercentageDiscount } from '../src/promotion/store-commerce-promotion-actions';
import { couponCollectionsForVariant } from '../src/promotion/store-coupon-collections';
import { StoreCouponVariantResolver } from '../src/promotion/store-promotion-campaign.resolver';

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        schema: gql`
            extend type ProductVariant {
                storeCouponCollectionIds: [ID!]!
            }
        `,
        resolvers: [StoreCouponVariantResolver],
    },
})
class CouponMembershipTestPlugin {}

describe('coupon SKU category contract (AUD-005)', () => {
    const { server, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [CouponMembershipTestPlugin],
            importExportOptions: { importAssetsDir: path.join(__dirname, '../../core/e2e/fixtures/assets') },
        }),
    );
    let connection: TransactionalConnection;
    let requestCache: RequestContextCacheService;
    let ctx: any;
    let variants: ProductVariant[];
    let categories: Collection[];
    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
        connection = server.app.get(TransactionalConnection);
        requestCache = server.app.get(RequestContextCacheService);
        ctx = await server.app.get(RequestContextService).create({ apiType: 'shop' });
        variants = await connection
            .getRepository(ctx, ProductVariant)
            .find({ order: { id: 'ASC' }, take: 2 });
        categories = [];
        for (let index = 0; index < 3; index++) {
            categories.push(
                await connection.getRepository(ctx, Collection).save(
                    new Collection({
                        position: index,
                        filters: [],
                        translations: [],
                        channels: [ctx.channel],
                        parent: index ? categories[index - 1] : undefined,
                    }),
                ),
            );
        }
        await connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder()
            .relation('collections')
            .of(variants[0].id)
            .add(categories[2].id);
        await collectionPercentageDiscount.init({ get: (token: any) => server.app.get(token) } as never);
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        await server.destroy();
    });

    it('matches child and grandchild SKUs at every selected ancestor in the order action', async () => {
        for (const category of categories) {
            const amount = await collectionPercentageDiscount.execute(
                ctx,
                {
                    unitPrice: 9900,
                    unitPriceWithTax: 9900,
                    productVariant: variants[0],
                } as never,
                [
                    { name: 'discount', value: '20' },
                    { name: 'collectionIds', value: JSON.stringify([String(category.id)]) },
                ],
                {},
                {} as never,
            );
            expect(amount).toBe(-1980);
        }
    });

    it('returns the same eligible categories through the real Shop API only for the matching SKU', async () => {
        const result = await shopClient.query(gql`
            query {
                product(slug: "laptop") {
                    variants {
                        id
                        storeCouponCollectionIds
                    }
                }
            }
        `);
        const item = result.product.variants.find((variant: any) => variant.id === 'T_' + variants[0].id);
        expect(item.storeCouponCollectionIds.sort()).toEqual(categories.map(c => 'T_' + c.id).sort());
        const sibling = result.product.variants.find((variant: any) => variant.id === 'T_' + variants[1].id);
        expect(sibling.storeCouponCollectionIds).toEqual([]);
    });

    it('does not apply a sibling SKU or another channel membership to this price', async () => {
        expect(await couponCollectionsForVariant(ctx, variants[1].id, connection, requestCache)).toEqual([]);
        const foreignContext = Object.create(ctx);
        Object.defineProperty(foreignContext, 'channelId', { value: '987654321' });
        expect(
            await couponCollectionsForVariant(foreignContext, variants[0].id, connection, requestCache),
        ).toEqual([]);
    });
});

import { describe, expect, it } from 'vitest';

import { AutoCardProductVariantResolver, AutoCardShopProductVariantResolver } from './auto-card.resolver';
import { CommerceFulfillmentPlugin } from './commerce-fulfillment.plugin';

describe('CommerceFulfillmentPlugin API resolver registration', () => {
    it('registers the saleable stock resolver only for the Shop API schema', () => {
        const adminApiExtensions = Reflect.getMetadata('adminApiExtensions', CommerceFulfillmentPlugin);
        const shopApiExtensions = Reflect.getMetadata('shopApiExtensions', CommerceFulfillmentPlugin);

        expect(adminApiExtensions.resolvers).toContain(AutoCardProductVariantResolver);
        expect(adminApiExtensions.resolvers).not.toContain(AutoCardShopProductVariantResolver);
        expect(shopApiExtensions.resolvers).toContain(AutoCardProductVariantResolver);
        expect(shopApiExtensions.resolvers).toContain(AutoCardShopProductVariantResolver);
    });
});

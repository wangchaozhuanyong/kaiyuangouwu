import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';

describe('commerce fulfillment GraphQL boundaries', () => {
    it('exposes the internal return stock location only through the Admin API', () => {
        expect(print(adminApiExtensions)).toContain('returnStockLocation: StockLocation');
        expect(print(shopApiExtensions)).not.toContain('returnStockLocation');
    });
});

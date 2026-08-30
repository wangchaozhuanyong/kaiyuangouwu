import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const routesDirectory = path.resolve(process.cwd(), 'src/app/routes/_authenticated/_products');

describe('product workbench integration', () => {
    it('creates variants in the product workbench instead of linking to a separate route', () => {
        const source = readFileSync(path.join(routesDirectory, 'products_.$id.tsx'), 'utf8');

        expect(source).toContain('<AddProductVariantDialog');
        expect(source).not.toContain('render={<Link to="./variants" />}');
    });

    it('uses the server-side filtered product list without serializing every product ID', () => {
        const source = readFileSync(path.join(routesDirectory, 'products.tsx'), 'utf8');
        const graphqlSource = readFileSync(path.join(routesDirectory, 'products.graphql.ts'), 'utf8');

        expect(source).toContain('catalogFilteredProductListDocument');
        expect(source).not.toContain('filteredProductIds');
        expect(source).not.toContain("filteredProductIds?.join(',')");
        expect(graphqlSource).toContain('products: catalogProducts');
    });
});

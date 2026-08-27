import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const customerFacingFiles = [
    './pages/product-detail-page.tsx',
    './components/common/product-card.tsx',
    './components/common/product-row.tsx',
    './storefront-ui/cart-ui.tsx',
    './checkout-page.tsx',
    './pages/account-page.tsx',
    './review-pages.tsx',
    './payment-pages.tsx',
    './order-pages.tsx',
];

describe('customer-facing SKU visibility', () => {
    it.each(customerFacingFiles)('does not render raw SKU values in %s', relativePath => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

        expect(source).not.toContain('.sku');
        expect(source).not.toContain('SKU:');
        expect(source).not.toContain('规格编码:');
    });
});

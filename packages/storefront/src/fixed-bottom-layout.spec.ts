import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { checkoutPageStyles } from './tailwind/checkout-page-styles';
import { orderPageStyles } from './tailwind/order-page-styles';

const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('fixed bottom layout clearance', () => {
    it('uses one page-level clearance model for every fixed bottom bar', () => {
        expect(stylesheet).toContain('--root-page-end-gap: 24px');
        expect(stylesheet).toContain('--page-bottom-fixed-height: var(--bottom-navigation-height)');
        expect(stylesheet).toContain('--page-bottom-fixed-height: var(--detail-action-bar-height)');
        expect(stylesheet).toContain('--page-bottom-fixed-height: var(--checkout-action-bar-height)');
        expect(stylesheet).toContain('--page-bottom-fixed-height: var(--order-detail-action-bar-height)');
        expect(stylesheet).toContain(
            '--page-bottom-fixed-height: calc(var(--bottom-navigation-height) + var(--cart-checkout-bar-height))',
        );
    });

    it('does not rely on last-section margin or form padding workarounds', () => {
        expect(stylesheet).not.toContain('margin-bottom: 80px');
        expect(checkoutPageStyles['checkout-form']).not.toContain('safe-bottom');
        expect(checkoutPageStyles['purchase-page']).not.toContain('padding-bottom:128px');
        expect(orderPageStyles['order-detail-summary']).not.toContain('margin-bottom:82px');
    });
});

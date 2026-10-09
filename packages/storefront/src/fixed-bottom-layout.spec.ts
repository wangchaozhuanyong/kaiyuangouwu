import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { checkoutPageStyles } from './tailwind/checkout-page-styles';
import { orderPageStyles } from './tailwind/order-page-styles';
import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

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
        expect(stylesheet).not.toContain('--checkout-viewport-bottom-offset');
        expect(stylesheet).toContain(
            'bottom: calc(var(--fixed-bottom-stack, 0px) + var(--storefront-viewport-bottom-offset, 0px))',
        );
        // Browser/keyboard movement belongs to fixed positioning, never document clearance.
        const offsetUses = stylesheet
            .split('\n')
            .filter(line => line.includes('--storefront-viewport-bottom-offset'));
        expect(offsetUses.length).toBeGreaterThan(0);
        expect(offsetUses.every(line => line.trim().startsWith('bottom:'))).toBe(true);
        expect(stylesheet).toMatch(
            /\.page:is\(\.product-detail-page, \.checkout-page, \.order-detail-page\):not\(:has\(\.page-action-bar\)\)\s*\{\s*--page-bottom-fixed-height: 0px;/,
        );
    });

    it('reserves bottom navigation clearance until the desktop layout starts', () => {
        expect(stylesheet).toMatch(
            /@media \(min-width: 1024px\) \{\s*\.page:not\(\.subpage\) \{\s*--page-bottom-fixed-height: 0px;/,
        );
        const navigationClearanceBreakpoints: number[] = [];
        postcss.parse(stylesheet).walkAtRules('media', media => {
            const minWidth = /min-width:\s*(\d+)px/.exec(media.params);
            if (!minWidth) return;
            media.walkRules('.page:not(.subpage)', rule => {
                rule.walkDecls('--page-bottom-fixed-height', declaration => {
                    if (declaration.value === '0px') {
                        navigationClearanceBreakpoints.push(Number(minWidth[1]));
                    }
                });
            });
        });
        expect(navigationClearanceBreakpoints).toEqual([1024]);
    });
});

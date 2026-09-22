import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

describe('shared control surfaces', () => {
    it('defines one semantic elevation system for every storefront preset', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/visual-presets.css']);

        expect(stylesheet).toMatch(
            /html\[data-storefront-preset\]\s*\{[^}]*--control-surface:[^;]+;[^}]*--control-elevation:/,
        );
        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- The two semantic surface aliases must remain in the same preset rule.
            /html\[data-storefront-preset\]\s*\{[^}]*--module-action-surface:\s*var\(--control-surface\);[^}]*--module-action-surface-hover:\s*var\(--control-surface-hover\);/,
        );
    });

    it('keeps shortcut row hierarchy in the shared module-action contract', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/desktop-home.css',
            './styles/visual-presets.css',
        ]);

        expect(stylesheet).toMatch(
            /\.desktop-store-layout[\s\S]*?\.quick-grid button\s*\{[^}]*background:\s*var\(--module-action-surface,/,
        );
        expect(stylesheet).toMatch(
            /\.quick-grid button:hover\s*\{[^}]*background:\s*var\(--module-action-surface-hover,/,
        );
        expect(stylesheet).toMatch(/--proto-tool-item-bg:\s*var\(--module-action-surface\);/);
        expect(stylesheet).toMatch(/--proto-tool-item-hover-bg:\s*var\(--module-action-surface-hover\);/);
        expect(stylesheet).not.toMatch(
            /html\[data-storefront-preset='modern-oriental'\][^{]*(?:\.quick-grid\s+button|\.proto-tool-item)(?:\s*:\s*hover)?\s*\{/,
        );
    });

    it('replaces visible outlines on selects and compact shell controls without flattening form fields', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/control-surfaces.css']);

        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- This is the complete shared select treatment contract.
            /html\[data-storefront-preset\] select:not\(\[multiple\]\)\s*\{[^}]*border:\s*0;[^}]*background-color:\s*var\(--control-surface\);[^}]*box-shadow:\s*var\(--control-elevation\);/,
        );
        expect(stylesheet).toContain('.currency-select:not(.topbar-capsule *)');
        expect(stylesheet).toContain('.proto-language-btn');
        expect(stylesheet).toContain('.desktop-outline-button');
        expect(stylesheet).not.toMatch(/html\[data-storefront-preset\]\s+input\s*\{/);
    });

    it('keeps keyboard and forced-colors boundaries visible', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/control-surfaces.css']);

        expect(stylesheet).toMatch(
            /select:not\(\[multiple\]\):focus-visible\s*\{[^}]*outline:\s*var\(--experience-focus-width\) solid/,
        );
        expect(stylesheet).toMatch(/@media \(forced-colors: active\)/);
    });

    it('removes decorative frames from shared commerce surfaces across every skin and viewport', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/control-surfaces.css']);

        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- Keeping all framed commerce surfaces together prevents partial regressions.
            /html\[data-storefront-preset\][\s\S]*?:is\([\s\S]*?\.cart-group,[\s\S]*?\.checkout-section,[\s\S]*?\.order-card,[\s\S]*?\.logistics-card,[\s\S]*?\.cart-checkout-bar,[\s\S]*?\)\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*var\(--skin-card-shadow\);/u,
        );
        expect(stylesheet).toMatch(
            /\.cart-page :is\(\.cart-group > header, \.desktop-cart-columns\)\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--soft\);/u,
        );
        expect(stylesheet).toMatch(
            /\.cart-page :is\(\.cart-line-swipe, \.desktop-cart-row\)\s*\{[^}]*border:\s*0;/u,
        );
        expect(stylesheet).toMatch(
            /@media \(min-width: 1024px\)[\s\S]*?\.desktop-store-layout \.cart-page \.cart-group\s*\{[^}]*padding-bottom:\s*10px;[^}]*background:\s*var\(--soft\);/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.cart-page \.desktop-cart-row\s*\{[^}]*margin:\s*8px 10px 0;[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*none;/u,
        );
        expect(stylesheet).toMatch(
            /@media \(forced-colors: active\)[\s\S]*?\.cart-group,[\s\S]*?border:\s*1px solid CanvasText;/u,
        );
    });

    it('gives Neo controls an even silhouette instead of a one-sided inset highlight', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/visual-presets.css']);
        const neoBlock = stylesheet.match(
            /html\[data-storefront-preset='neo-minimalist'\]\s*\{([\s\S]*?)\n\}/,
        )?.[1];

        expect(neoBlock).toContain('--control-surface-image: radial-gradient(');
        expect(neoBlock).toMatch(/--control-elevation:\s*\n\s*0 0 0 1px/);
        expect(neoBlock).not.toContain('inset 0 1px');
    });
});

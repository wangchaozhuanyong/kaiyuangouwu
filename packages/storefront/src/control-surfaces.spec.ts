import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

describe('shared control surfaces', () => {
    it('defines one semantic elevation system for every storefront preset', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/visual-presets.css']);

        expect(stylesheet).toMatch(
            /html\[data-storefront-preset\]\s*\{[^}]*--control-surface:[^;]+;[^}]*--control-elevation:/,
        );
        expect(stylesheet).toMatch(
            new RegExp(
                String.raw`html\[data-storefront-preset\]\s*\{[^}]*--module-action-surface:\s*var\(--control-surface\);` +
                    String.raw`[^}]*--module-action-surface-hover:\s*var\(--control-surface-hover\);`,
            ),
        );
    });

    it('keeps image shortcuts legible and keyboard-visible beside shared module actions', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/desktop-home.css',
            './styles/visual-presets.css',
        ]);

        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.homepage-modules \.home-intro-grid \.desktop-quick-tile\s*\{[^}]*background:\s*var\(--soft\);/,
        );
        expect(stylesheet).toMatch(
            /\.desktop-quick-tile::after\s*\{[^}]*z-index:\s*1;[^}]*background:\s*linear-gradient\(/,
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.home-intro-grid \.quick-grid b\s*\{[^}]*z-index:\s*2;/,
        );
        expect(stylesheet).toMatch(
            /\.desktop-quick-tile:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\);/,
        );
        expect(stylesheet).toMatch(
            /\.desktop-quick-tile:hover::after\s*\{[^}]*background:\s*linear-gradient\(/,
        );
        expect(stylesheet).toMatch(/--proto-tool-item-bg:\s*var\(--module-action-surface\);/);
        expect(stylesheet).toMatch(/--proto-tool-item-hover-bg:\s*var\(--module-action-surface-hover\);/);
        expect(stylesheet).not.toMatch(
            /html\[data-storefront-preset='neo-minimalist'\][^{]*(?:\.quick-grid\s+button|\.proto-tool-item)(?:\s*:\s*hover)?\s*\{/,
        );
    });

    it('replaces visible outlines on selects and compact shell controls without flattening form fields', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/control-surfaces.css']);

        expect(stylesheet).toMatch(
            new RegExp(
                String.raw`:where\(\.storefront-app, \.sheet-layer\) select:not\(\[multiple\]\)\s*\{[^}]*border:\s*0;` +
                    String.raw`[^}]*background-color:\s*var\(--control-surface\);[^}]*box-shadow:\s*var\(--control-elevation\);`,
            ),
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

    it('keeps every skin on the same tonal controls without decorative glow or gradients', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/visual-presets.css']);
        const neoBlock = stylesheet.match(
            /html\[data-storefront-preset='neo-minimalist'\]\s*\{([\s\S]*?)\n\}/,
        )?.[1];

        expect(neoBlock).not.toContain('--control-surface');
        expect(neoBlock).not.toContain('--control-elevation');
        expect(stylesheet).toContain('--control-elevation: none;');
        expect(stylesheet).toContain('--control-surface-image: none;');
    });
});

import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

describe('locale preferences presentation', () => {
    it('uses the shared desktop action surface and a responsive dialog', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/locale-preferences.css',
            './styles/desktop-home.css',
        ]);

        expect(stylesheet).toMatch(
            /\.locale-preferences-trigger\s*\{[^}]*border:\s*0;[^}]*background-color:\s*var\(--control-surface[^}]*background-image:\s*var\(--control-surface-image/,
        );
        expect(stylesheet).toMatch(
            /\.proto-header-right > \.proto-header-action\s*\{[^}]*background-color:\s*var\(--control-surface\);[^}]*box-shadow:\s*var\(--control-elevation\);/,
        );
        expect(stylesheet).toMatch(
            /\.proto-header-right > \.proto-header-action:hover\s*\{[^}]*background:\s*var\(--interaction-hover\);/,
        );
        expect(stylesheet).toMatch(
            /\.locale-preferences-language\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
        );
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*460px\)[\s\S]*\.locale-preferences-currencies\s*\{[^}]*grid-template-columns:\s*1fr;/,
        );
    });

    it('targets portal-mounted sheets through the desktop layout marker on body', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/desktop-pages.css',
            './styles/locale-preferences.css',
        ]);

        expect(stylesheet).toMatch(
            /body:has\(\.desktop-store-layout\) \.sheet-layer\s*\{[^}]*place-items:\s*center;/,
        );
        expect(stylesheet).toMatch(
            /body:has\(\.desktop-store-layout\) \.sheet-layer > \.locale-preferences-sheet\s*\{[^}]*width:\s*min\(520px, 100%\);/,
        );
    });
});

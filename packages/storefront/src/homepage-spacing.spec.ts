import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet(['./styles/desktop-home.css']);
const homePageSource = readFileSync(new URL('./pages/home-page.tsx', import.meta.url), 'utf8');

describe('homepage module spacing', () => {
    it('uses one mobile spacing system for every top-level module', () => {
        expect(stylesheet).toMatch(
            new RegExp(
                '\\.homepage-modules\\s*\\{[^}]*--homepage-module-gap:\\s*var\\(--space-section\\);' +
                    '[^}]*--homepage-section-gap:\\s*var\\(--space-major\\);[^}]*gap:\\s*var\\(--homepage-module-gap\\);' +
                    '[^}]*padding-top:\\s*var\\(--homepage-module-gap\\);',
            ),
        );
        expect(stylesheet).toMatch(
            /\.homepage-module-shell\.is-section-start\s*\{[^}]*margin-block-start:\s*calc\(var\(--homepage-section-gap\) - var\(--homepage-module-gap\)\);/,
        );
        expect(stylesheet).toMatch(
            /\.homepage-modules > \.notice-strip,[\s\S]*?\.homepage-module-shell > \.empty-state\s*\{[^}]*margin-block:\s*0;/,
        );
    });

    it('keeps mobile module edges and quick-link content balanced', () => {
        expect(stylesheet).toMatch(
            new RegExp(
                '@media \\(max-width: 1023px\\)\\s*\\{\\s*\\.home-page \\.notice-strip,' +
                    '\\s*\\.hero-carousel,\\s*\\.quick-grid,\\s*\\.quick-grid\\.is-color-marketplace' +
                    '\\s*\\{\\s*margin-inline:\\s*var\\(--space-8\\);',
            ),
        );
        expect(stylesheet).toMatch(
            /\.quick-grid\s*\{[^}]*margin:\s*0 var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\);[^}]*padding:\s*14px 8px;/,
        );
        expect(stylesheet).toMatch(/\.quick-grid :is\(button, a\)\s*\{[^}]*justify-content:\s*center;/);
        expect(stylesheet).toMatch(/\.quick-grid b\s*\{[^}]*min-height:\s*0;[^}]*margin-top:\s*0;/);
        expect(stylesheet).toMatch(
            /\.home-dual-showcase\s*\{[^}]*margin:\s*0 var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\);/,
        );
        expect(stylesheet).toMatch(
            /\.legal-footer\s*\{[^}]*margin:\s*var\(--space-section\) var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\) 0;/,
        );
        expect(stylesheet).toMatch(
            new RegExp(
                '\\.quick-grid b\\s*\\{[^}]*width:\\s*100%;[^}]*min-width:\\s*0;' +
                    '[^}]*font-size:\\s*var\\(--type-navigation-compact-size\\);' +
                    '[^}]*line-height:\\s*var\\(--type-navigation-compact-leading\\);[^}]*white-space:\\s*normal;',
            ),
        );
        expect(stylesheet).not.toMatch(/html\[lang='en'\] \.quick-grid b\s*\{/);
    });

    it('uses the same hierarchy with desktop spacing values', () => {
        expect(stylesheet).toMatch(
            new RegExp(
                '@media \\(min-width:\\s*1024px\\)[\\s\\S]*?\\.homepage-modules\\s*\\{' +
                    '[^}]*--homepage-module-gap:\\s*var\\(--space-section\\);[^}]*--homepage-section-gap:\\s*var\\(--space-major\\);' +
                    '[^}]*padding-top:\\s*var\\(--homepage-module-gap\\);',
            ),
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.home-intro-grid \.quick-grid b\s*\{[^}]*white-space:\s*nowrap;/,
        );
    });

    it('marks every titled or terminal homepage section with section spacing', () => {
        expect(homePageSource).toContain(
            "const homepageSectionShellClassName = 'homepage-module-shell is-section-start';",
        );
        expect(homePageSource.match(/className=\{homepageSectionShellClassName\}/g)).toHaveLength(6);
    });
});

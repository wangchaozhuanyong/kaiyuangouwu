import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const homePageSource = readFileSync(new URL('./pages/home-page.tsx', import.meta.url), 'utf8');

describe('homepage module spacing', () => {
    it('uses one mobile spacing system for every top-level module', () => {
        const mobileModuleSpacing = new RegExp(
            String.raw`\.homepage-modules\s*\{[^}]*--homepage-module-gap:\s*12px;[^}]*` +
                String.raw`--homepage-section-gap:\s*20px;[^}]*` +
                String.raw`gap:\s*var\(--homepage-module-gap\);[^}]*padding-top:\s*8px;`,
        );
        expect(stylesheet).toMatch(mobileModuleSpacing);
        expect(stylesheet).toMatch(
            /\.homepage-module-shell\.is-section-start\s*\{[^}]*margin-block-start:\s*calc\(var\(--homepage-section-gap\) - var\(--homepage-module-gap\)\);/,
        );
        expect(stylesheet).toMatch(
            /\.homepage-modules > \.notice-strip,[\s\S]*?\.homepage-module-shell > \.empty-state\s*\{[^}]*margin-block:\s*0;/,
        );
    });

    it('keeps mobile module edges and quick-link content balanced', () => {
        expect(stylesheet).toMatch(/\.quick-grid\s*\{[^}]*margin:\s*0 12px 10px;[^}]*padding:\s*14px 8px;/);
        expect(stylesheet).toMatch(/\.quick-grid button\s*\{[^}]*justify-content:\s*center;/);
        expect(stylesheet).toMatch(/\.quick-grid b\s*\{[^}]*min-height:\s*0;[^}]*margin-top:\s*0;/);
        expect(stylesheet).toMatch(/\.home-dual-showcase\s*\{[^}]*margin:\s*12px;/);
        expect(stylesheet).toMatch(/\.legal-footer\s*\{[^}]*margin:\s*0 12px;/);
    });

    it('uses the same hierarchy with desktop spacing values', () => {
        const desktopModuleSpacing = new RegExp(
            String.raw`@media \(min-width:\s*900px\)[\s\S]*?\.homepage-modules\s*\{[^}]*` +
                String.raw`--homepage-module-gap:\s*16px;[^}]*` +
                String.raw`--homepage-section-gap:\s*24px;[^}]*padding-top:\s*16px;`,
        );
        expect(stylesheet).toMatch(desktopModuleSpacing);
    });

    it('marks every titled or terminal homepage section with section spacing', () => {
        expect(homePageSource).toContain(
            "const homepageSectionShellClassName = 'homepage-module-shell is-section-start';",
        );
        expect(homePageSource.match(/className=\{homepageSectionShellClassName\}/g)).toHaveLength(6);
    });
});

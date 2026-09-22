import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function stylesheet(relativePath: string): string {
    return readFileSync(path.join(__dirname, relativePath), 'utf8');
}

function presetRootBlock(source: string, presetId: string): string {
    const marker = `html[data-storefront-preset='${presetId}'] {`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Missing preset root block: ${presetId}`);
    const end = source.indexOf('\n}', start);
    if (end < 0) throw new Error(`Unclosed preset root block: ${presetId}`);
    return source.slice(start, end + 2);
}

describe('storefront skin system', () => {
    it('keeps color ownership in the shared semantic palette instead of preset CSS copies', () => {
        const source = stylesheet('./styles/visual-presets.css');
        const semanticTokens = [
            '--bg',
            '--paper',
            '--surface',
            '--soft',
            '--text',
            '--muted',
            '--line',
            '--accent',
            '--accent-hover',
            '--accent-ink',
            '--accent-soft',
            '--accent-foreground',
        ];

        for (const presetId of ['modern-oriental', 'neo-minimalist']) {
            const block = presetRootBlock(source, presetId);
            for (const token of semanticTokens) {
                expect(block).not.toMatch(new RegExp(`${token.replace(/-/g, '\\-')}\\s*:`));
            }
        }
    });

    it('derives shared component aliases from the selected semantic palette and treatment', () => {
        const source = stylesheet('./styles/visual-presets.css');

        expect(source).toMatch(
            /html\[data-storefront-preset\]\s*\{[^}]*--radius-sm:\s*var\(--skin-control-radius[\s\S]*?--shadow-sm:\s*var\(--skin-card-shadow\)/,
        );
        expect(source).toContain('--warning-bg: color-mix(in srgb, var(--warning) 10%, var(--surface));');
        expect(source).toContain('--product-media-bg: color-mix(in srgb, var(--soft) 72%, var(--surface));');
        expect(source).toMatch(
            // eslint-disable-next-line max-len -- Foreground and background tokens must stay paired in one action rule.
            /html\[data-storefront-preset\] \.primary-action,[\s\S]*?background:\s*var\(--auth-accent, var\(--accent\)\);[\s\S]*?color:\s*var\(--auth-button-foreground, var\(--accent-foreground\)\);/,
        );
        expect(source).toMatch(
            /\.primary-action:disabled,[\s\S]*?background:\s*var\(--accent-disabled-bg\);[\s\S]*?color:\s*var\(--accent-disabled-text\);/,
        );
    });

    it('keeps desktop component geometry attached to skin roles', () => {
        const source = [
            stylesheet('./styles/desktop-home.css'),
            stylesheet('./styles/desktop-commerce.css'),
            stylesheet('./styles/desktop-pages.css'),
        ].join('\n');

        expect(source).not.toMatch(/border-radius:\s*(?:8|10|12|14|16|18|20)px/);
        expect(source).not.toContain('var(--focus-ring)');
        expect(source).not.toContain('.proto-product-card');
        expect(source).not.toContain('.proto-sort-group');
    });

    it('skins the browser scrollbar instead of pinning it to a light-only color', () => {
        const source = stylesheet('./styles.css');

        expect(source).toContain('scrollbar-color: var(--skin-divider) transparent;');
        expect(source).toMatch(/::-webkit-scrollbar-thumb[\s\S]*?background:\s*var\(--skin-divider\);/);
    });

    it('uses one mobile content gutter without changing card geometry for sparse sections', () => {
        const foundations = stylesheet('./styles.css');
        const components = stylesheet('./styles/home-showcase.css');

        expect(foundations).toMatch(
            /@media \(max-width:\s*1023px\)[\s\S]*?\.storefront-app\s*\{[^}]*--page-section-inset:\s*var\(--experience-page-gutter-mobile\);/u,
        );
        expect(foundations).toMatch(
            /\.topbar\s*\{[^}]*padding:\s*4px var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\);/u,
        );
        expect(components).toMatch(
            /\.content-section,[\s\S]*?\.product-section\s*\{[^}]*padding:\s*0 var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\);/u,
        );
        expect(components).not.toContain('.product-grid > .product-card:only-child');
        expect(components).toMatch(
            /\.legal-footer\s*\{[^}]*margin:\s*0 var\(--page-section-inset, var\(--experience-page-gutter-mobile\)\);/u,
        );
    });

    it('preserves the centered account recommendation artwork across every skin', () => {
        const accountPage = stylesheet('./pages/account-page.tsx');
        const presets = stylesheet('./styles/visual-presets.css');

        expect(accountPage).toContain('ACCOUNT_RECOMMENDATION_CREST_IMAGE');
        expect(accountPage).toContain("centerLabel={isZh ? '专属推荐' : 'Just for you'}");
        expect(accountPage).toContain('--account-recommendation-image');
        expect(accountPage).toContain('[&_.section-header]:place-items-center');
        expect(presets).not.toContain('.account-recommendations > .section-header');
        expect(presets).not.toContain('.account-recommendations .section-header-center-label');
    });

    it('keeps product geometry stable regardless of result count and uses desktop tool workbenches', () => {
        const commerce = stylesheet('./styles/desktop-commerce.css');
        const pages = stylesheet('./styles/desktop-pages.css');

        expect(commerce).not.toContain('.product-row.product-catalog-card:only-child');
        expect(commerce).not.toContain('.desktop-product-grid:has(> .product-row:only-child)');
        expect(pages).not.toContain('.product-card:only-child');
        expect(pages).toMatch(
            // eslint-disable-next-line max-len -- The workbench column contract is intentionally asserted as one rule.
            /\.desktop-store-layout \.ai-studio-shell\.ai-studio-workflow \.ai-studio-create-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(340px, 400px\);/u,
        );
        expect(pages).toMatch(
            /\.desktop-store-layout \.ai-studio-shell\.ai-studio-workflow \.ai-studio-composer,[\s\S]*?box-shadow:\s*var\(--skin-card-shadow\);/u,
        );
    });

    it('uses one shared account workbench hierarchy instead of floating page controls', () => {
        const commerce = stylesheet('./styles/desktop-commerce.css');
        const pages = stylesheet('./styles/desktop-pages.css');
        const security = stylesheet('./styles/account-security.css');

        expect(pages).toContain('.desktop-account-workbench-toolbar');
        expect(pages).toContain('.address-workbench-toolbar');
        expect(pages).toContain('.desktop-account-layout .page > .empty-state');
        expect(commerce).toContain('.desktop-store-layout .order-tabs');
        expect(commerce).toContain('.desktop-store-layout .orders-page > .order-search');
        expect(security).toMatch(/\.account-security-page\s*\{[^}]*background:\s*var\(--bg\);/u);
        expect(security).toContain('background: var(--accent-soft);');
    });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDirectory = path.join(__dirname, 'styles');

describe('shared interaction performance contract', () => {
    it('does not animate every CSS property on storefront controls and surfaces', () => {
        const stylesheets = [
            path.join(__dirname, 'styles.css'),
            ...readdirSync(stylesDirectory)
                .filter(fileName => fileName.endsWith('.css'))
                .map(fileName => path.join(stylesDirectory, fileName)),
        ];

        for (const stylesheet of stylesheets) {
            expect(readFileSync(stylesheet, 'utf8'), path.basename(stylesheet)).not.toMatch(
                /\btransition\s*:\s*all\b/i,
            );
        }
    });

    it('limits readiness observation to attributes that can change page readiness', () => {
        const source = readFileSync(path.join(__dirname, 'page-readiness.tsx'), 'utf8');

        expect(source).toContain('attributeFilter: [');
        expect(source).toContain("'data-page-pending'");
        expect(source).toContain("'data-safe-image'");
        expect(source).not.toContain("attributeFilter: ['class', 'style'");
    });

    it('respects reduced-motion preferences across the whole storefront', () => {
        const source = readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

        expect(source).toMatch(
            /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.storefront-app \*[\s\S]*?transition: none !important;/,
        );
    });

    it('keeps layout, focus and motion foundations independent from skin expression', () => {
        const entry = readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
        expect(entry).toContain("@import './styles/experience-foundations.css'");
        const source = readFileSync(path.join(stylesDirectory, 'experience-foundations.css'), 'utf8');

        for (const token of [
            '--experience-content-max',
            '--experience-page-gutter-mobile',
            '--experience-page-gutter-desktop',
            '--experience-control-min',
            '--experience-focus-width',
            '--experience-motion-standard',
        ]) {
            expect(source).toContain(token);
        }
    });

    it('keeps storefront entry and stylesheet performance budgets enabled', () => {
        const source = readFileSync(path.join(__dirname, '../scripts/verify-production-build.mjs'), 'utf8');

        expect(source).toContain('const entryBudgetBytes = 380 * 1024;');
        expect(source).toContain('const styleBudgetBytes = 380 * 1024;');
        expect(source).toContain('const routeStyleBudgetBytes = 32 * 1024;');
        expect(source).toContain("'account-security-page-'");
        expect(source).toContain("'checkout-payment-surfaces-'");
        expect(source).toContain("'product-detail-page-'");
        expect(source).toContain("'search-page-'");
        expect(source).toContain("'order-pages-'");
        expect(source).toContain('host-resolved LCP preload include');
    });

    it('loads page-family styles with lazy route groups instead of the critical entry', () => {
        const entry = readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');
        const baseStyles = readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
        const authPages = readFileSync(path.join(__dirname, 'auth-pages.tsx'), 'utf8');
        const authStyles = readFileSync(path.join(stylesDirectory, 'auth-shell.css'), 'utf8');
        const logisticsStyles = readFileSync(path.join(stylesDirectory, 'logistics.css'), 'utf8');
        const routeStyles = {
            account: readFileSync(path.join(__dirname, 'route-pages/account-route-pages.tsx'), 'utf8'),
            auth: readFileSync(path.join(__dirname, 'route-pages/auth-route-pages.tsx'), 'utf8'),
            catalog: readFileSync(path.join(__dirname, 'route-pages/catalog-route-pages.tsx'), 'utf8'),
            content: readFileSync(path.join(__dirname, 'route-pages/content-route-pages.tsx'), 'utf8'),
            order: readFileSync(path.join(__dirname, 'route-pages/order-route-pages.tsx'), 'utf8'),
        };
        const categoryPages = [
            readFileSync(path.join(__dirname, 'pages/category-page.tsx'), 'utf8'),
            readFileSync(path.join(__dirname, 'pages/desktop-catalog-page.tsx'), 'utf8'),
        ];

        expect(baseStyles).not.toContain('account-catalog-surfaces.css');
        expect(baseStyles).not.toContain('account-security.css');
        expect(baseStyles).not.toContain('logistics.css');
        expect(baseStyles).not.toContain('auth-shell.css');
        expect(authPages).toContain("import './styles/auth-shell.css'");
        expect(authStyles).toContain('.auth-page {');
        expect(logisticsStyles).not.toContain('.auth-page {');
        expect(entry).not.toContain('storefront-design-preview.css');
        expect(routeStyles.account).toContain('../styles/account-catalog-surfaces.css');
        expect(routeStyles.catalog).not.toContain('../styles/account-catalog-surfaces.css');
        for (const page of categoryPages) {
            expect(page).toContain('../styles/account-catalog-surfaces.css');
        }
        expect(routeStyles.content).toContain('../styles/account-catalog-surfaces.css');
    });
});

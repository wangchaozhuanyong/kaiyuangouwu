import { readdirSync, readFileSync } from 'node:fs';
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
    it('allows only root token declarations in the skin adapter, never component or responsive overrides', () => {
        const source = stylesheet('./styles/visual-presets.css').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(source).not.toMatch(/@|!important|--color-/);
        const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        expect(rules).toHaveLength(3);
        for (const [, selector, body] of rules) {
            expect(selector.trim()).toMatch(
                /^html\[data-storefront-preset(?:='(?:modern-oriental|neo-minimalist)')?\]$/,
            );
            for (const declaration of body
                .split(';')
                .map(value => value.trim())
                .filter(Boolean)) {
                expect(declaration).toMatch(/^--[a-z-]+:/);
            }
        }
    });

    it('prevents skin identity selectors from leaking into component and lazy stylesheets', () => {
        const visit = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(file);
                else if (file.endsWith('.css')) {
                    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
                    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                        if (!selector.includes('data-storefront-preset')) continue;
                        expect(selector.trim(), file).toMatch(
                            /^html\[data-storefront-preset(?:='[a-z-]+')?\]$/,
                        );
                        for (const declaration of body
                            .split(';')
                            .map(value => value.trim())
                            .filter(Boolean)) {
                            expect(declaration, file).toMatch(/^--[a-z-]+:/);
                        }
                    }
                }
            }
        };
        visit(__dirname);
        visit(path.resolve(__dirname, '../../storefront-content-plugin/src/shared'));
    });

    it('keeps category navigation out of the lazy account chunk and controls out of theme patches', () => {
        expect(stylesheet('./styles/account-catalog-surfaces.css')).not.toMatch(
            /\.category-(?:page|topbar|navigation-shell)/,
        );
        expect(stylesheet('./styles/home-showcase.css')).toContain(
            '.category-navigation-shell > .topbar.category-topbar',
        );
        expect(stylesheet('./tailwind/order-page-styles.ts')).not.toMatch(/'order-(?:tabs|search)':/);
        expect(stylesheet('./styles/order-navigation.css')).not.toMatch(
            /backdrop-filter:\s*blur|transition:\s*all/,
        );
        for (const file of ['two-factor-page.tsx', 'vault-controls.tsx']) {
            expect(stylesheet(`./client-plugins/two-factor/${file}`)).not.toMatch(
                /\bbg-white\b|\btext-slate-\d+/,
            );
        }
    });

    it('lets the shared header own its surface without a skin selector overriding desktop composition', () => {
        const skin = stylesheet('./styles/visual-presets.css').split('@media (max-width: 1023px)')[0];
        expect(skin).not.toMatch(/\.(?:topbar|subpage-header)\b[^{}]*\{[^}]*(?:background|box-shadow):/);
        expect(stylesheet('./styles.css')).toMatch(
            /\.topbar\s*\{[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*var\(--shadow-sm\);/,
        );
        expect(stylesheet('./styles/desktop-commerce.css')).not.toContain('.cart-topbar');
        expect(stylesheet('./styles/desktop-pages.css')).toMatch(
            /\.desktop-store-layout \.cart-topbar\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
        );
    });

    it('keeps cart surfaces in their component owner and desktop merchandise rows borderless', () => {
        const layout = stylesheet('./styles/desktop-layout.css');
        const skin = stylesheet('./styles/visual-presets.css').split('@media (max-width: 1023px)')[0];
        expect(layout).not.toMatch(/\.cart-group\s*[,\{]/);
        expect(skin).not.toContain('.cart-group');
        expect(stylesheet('./styles/cart-layout.css')).toMatch(
            /\.cart-group\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*border:\s*0;/,
        );
        const desktopRow =
            [...stylesheet('./styles/desktop-pages.css').matchAll(/\.desktop-cart-row\s*\{([^}]*)\}/g)]
                .map(match => match[1])
                .find(rule => rule.includes('background: transparent;')) ?? '';
        expect(desktopRow).toContain('background: transparent;');
        expect(desktopRow).toContain('border-top: 0;');
        expect(desktopRow).toContain('border-radius: 0;');
        expect(desktopRow).toContain('box-shadow: none;');
    });

    it('owns populated logistics surfaces in one semantic component stylesheet', () => {
        const source = stylesheet('./styles/logistics.css').split('.address-list')[0];
        expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|background:\s*white|backdrop-filter|transition:\s*all/i);
        expect(source).toContain('var(--surface)');
        expect(source).toContain('var(--skin-card-radius)');
        expect(source).toContain('overflow-wrap: anywhere');
        expect(source).toContain('object-fit: contain');
        expect(stylesheet('./styles/desktop-pages.css')).not.toContain('.logistics-card');
        expect(stylesheet('./styles/visual-presets.css')).not.toContain('.logistics-card');
        expect(stylesheet('./tailwind/order-page-styles.ts')).not.toContain("'logistics-card':");
    });

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
        const controls = stylesheet('./styles/control-surfaces.css');
        const primaryAction = controls.match(/\.primary-action\s*\{([^}]+)\}/)?.[1];
        expect(primaryAction).toContain('background: var(--auth-accent, var(--accent));');
        expect(primaryAction).toContain('color: var(--auth-button-foreground, var(--accent-foreground));');
        expect(controls).toMatch(
            /\.primary-action:disabled\s*\{[^}]*background:\s*var\(--accent-disabled-bg\);[^}]*color:\s*var\(--accent-disabled-text\);/,
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

    it('gives shared product cards sole ownership of their internal composition', () => {
        for (const file of [
            'desktop-home',
            'desktop-catalog',
            'desktop-commerce',
            'home-showcase',
            'visual-presets',
        ]) {
            const source = stylesheet(`./styles/${file}.css`);
            expect(source, file).not.toMatch(/\.product-card\b/);
            expect(source, file).not.toContain('.product-row-catalog');
        }
        const card = stylesheet('./styles/product-card.css');
        expect(card).toContain('aspect-ratio: var(--product-media-ratio)');
        expect(card).toContain('object-fit: contain');
        expect(card).toContain('border-radius: var(--skin-card-radius) var(--skin-card-radius) 0 0');
    });

    it('scopes controls to storefront surfaces and themes consent through shared tokens', () => {
        const controls = stylesheet('./styles/control-surfaces.css');
        const consent = stylesheet('./styles/traffic-consent.css');
        expect(controls).toContain(':where(.storefront-app, .sheet-layer)');
        expect(controls).not.toContain('html[data-storefront-preset]');
        expect(consent).toContain('background: var(--surface-elevated)');
        expect(consent).toContain('color: var(--accent-foreground)');
        expect(consent).not.toMatch(/#[0-9a-f]{3,8}\b|backdrop-filter/);
    });

    it('routes account security actions and status copy through semantic colors', () => {
        const source = stylesheet('./styles/account-security.css');

        expect(source).toMatch(/\.security-avatar-actions button,[\s\S]*?color:\s*var\(--accent-ink\);/);
        expect(source).toMatch(
            /\.security-item-danger \.security-item-title\s*\{[^}]*color:\s*var\(--danger\);/,
        );
        expect(source).toMatch(/\.security-privacy-message\s*\{[^}]*color:\s*var\(--success\);/);
    });

    it('gives checkout line geometry one owner across desktop, purchase and skins', () => {
        const source = stylesheet('./styles/checkout-items.css');
        expect(source).toContain('grid-template-columns: 76px minmax(0, 1fr) auto;');
        expect(source).toContain('width: fit-content;');
        expect(source).toContain('object-fit: contain;');
        expect(source).not.toContain('!important');
        expect(stylesheet('./tailwind/checkout-page-styles.ts')).not.toContain('checkout-items');
        expect(stylesheet('./styles/desktop-pages.css')).not.toContain('.checkout-items');
        expect(stylesheet('./styles/visual-presets.css')).not.toContain('.checkout-items');
    });

    it('owns all quantity controls in one component and stylesheet with touch-sized actions', () => {
        const source = stylesheet('./styles/quantity-control.css');
        expect(source).toMatch(
            /\.quantity-control\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*background:\s*var\(--control-surface\);/,
        );
        expect(source).toMatch(/\.quantity-control > button\s*\{[^}]*height:\s*44px;/);
        for (const file of [
            './checkout-page.tsx',
            './pages/product-detail-page.tsx',
            './storefront-ui/cart-ui.tsx',
        ]) {
            expect(stylesheet(file)).toContain('<QuantityControl');
        }
        for (const file of [
            './styles/checkout-items.css',
            './styles/product-detail-surfaces.css',
            './styles/cart-layout.css',
            './styles/desktop-pages.css',
        ]) {
            expect(stylesheet(file)).not.toMatch(
                /\.purchase-quantity-control|\.detail-quantity-controls|\.cart-line-actions > div|\.desktop-cart-quantity (?:> button|svg|> span)/,
            );
        }
        expect(stylesheet('./tailwind/checkout-page-styles.ts')).not.toContain('purchase-quantity-control');
    });

    it('keeps two-factor supporting content flat instead of nesting framed panels', () => {
        const page = stylesheet('./client-plugins/two-factor/two-factor-page.tsx');
        const vault = stylesheet('./client-plugins/two-factor/vault-controls.tsx');
        for (const role of [
            'vault',
            'privacy',
            'accounts',
            'account-form',
            'batch-form',
            'query-result',
            'empty',
            'account-code',
        ]) {
            const classes = [
                ...`${page}\n${vault}`.matchAll(new RegExp(`className="(two-factor-${role}[^"\\n]*)"`, 'g')),
            ];
            expect(classes.length, role).toBeGreaterThan(0);
            for (const [, className] of classes) {
                expect(className, role).not.toMatch(/(?:^|\s)(?:rounded|border|shadow|bg)-?/);
            }
        }
        expect(page).toContain('border border-[var(--line)]');
        expect(page).not.toContain('border-dashed');
        expect(stylesheet('./styles/desktop-pages.css')).not.toContain(
            '.desktop-two-factor-content > :is(section, aside)',
        );
    });

    it('allocates desktop two-factor space to the work area instead of a full-height privacy column', () => {
        const source = stylesheet('./client-plugins/two-factor/two-factor-page.tsx');
        const layout = stylesheet('./client-plugins/two-factor/two-factor-page.css');
        expect(source).toContain('two-factor-workspace');
        expect(layout).toContain('grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);');
        expect(layout).toMatch(/\.two-factor-privacy\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/);
        expect(layout).toMatch(/\.two-factor-accounts\s*\{[^}]*grid-column: 2;/);
        expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))]');
        expect(stylesheet('./styles/desktop-pages.css')).not.toMatch(
            /\.desktop-two-factor-content\s*\{[^}]*grid-template-columns/,
        );
    });

    it('pairs order status copy with semantic surfaces for every skin', () => {
        const source = stylesheet('./tailwind/order-page-styles.ts');
        const status = source.match(/'order-status':\s*'([^']+)'/)?.[1];
        expect(status).toContain('[background:var(--surface)]');
        expect(status).toContain('[color:var(--text)]');
        expect(status).toContain('[&_small]:[color:var(--muted)]');
        expect(status).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });

    it('uses semantic surfaces for review panels and their form controls', () => {
        const source = stylesheet('./styles/ai-product-covers.css');
        expect(source).toMatch(/\.review-composer\s*\{[^}]*background:\s*var\(--surface\);/);
        expect(source).toMatch(/\.review-composer textarea\s*\{[^}]*background:\s*var\(--control-surface\);/);
        expect(source).toMatch(/\.review-submit\s*\{[^}]*color:\s*var\(--accent-foreground\);/);
        expect(source).toMatch(/\.review-rating-input button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
        expect(source).toMatch(/\.review-state.is-approved\s*\{[^}]*var\(--success\)/);
        expect(source).toMatch(/\.product-review-list article\s*\{[^}]*overflow-wrap:\s*anywhere;/);
        expect(source).toMatch(/\.review-composer textarea\s*\{[^}]*border:\s*1px solid var\(--line\);/);
        expect(source).toContain('outline: var(--experience-focus-width) solid var(--focus);');
    });

    it('keeps panel headings and review lists free of decorative rules across component and layout owners', () => {
        const borderlessSelectors = [
            '.section-header',
            '.review-center-section > header',
            '.review-composer > header',
            '.review-candidate-row',
            '.my-review-list article',
            '.product-review-list article',
            '.coupon-center-cart-link',
            '.payment-summary > header',
            '.account-page .account-section',
            '.sheet > header',
            '.support-evaluation-header',
        ];
        const seen = new Set<string>();
        const files = [
            path.join(__dirname, 'styles.css'),
            ...readdirSync(path.join(__dirname, 'styles'))
                .filter(file => file.endsWith('.css'))
                .map(file => path.join(__dirname, 'styles', file)),
        ];
        for (const file of files) {
            const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                for (const target of borderlessSelectors) {
                    if (!selector.split(',').some(part => part.trim().endsWith(target))) continue;
                    seen.add(target);
                    for (const declaration of body.split(';')) {
                        const border = declaration.match(/^\s*(border(?:-[a-z]+)*)\s*:\s*([\s\S]*)$/);
                        if (!border || /(?:radius|color|style)$/.test(border[1])) continue;
                        expect(border[2].trim(), `${file}: ${selector}`).toMatch(/^(?:0(?:px)?|none)$/);
                    }
                }
            }
        }
        expect([...seen].sort()).toEqual([...borderlessSelectors].sort());
    });

    it('shares one lazy semantic aftercare owner across order details and confirmation', () => {
        const source = stylesheet('./styles/order-aftercare.css');
        const utilities = stylesheet('./tailwind/order-page-styles.ts');
        for (const page of ['./order-pages.tsx', './payment-pages.tsx']) {
            expect(stylesheet(page)).toContain("import './styles/order-aftercare.css'");
        }
        expect(utilities).not.toContain("'digital-delivery-panel':");
        expect(utilities).not.toContain("'after-sales-return-form':");
        expect(source).toMatch(/\.after-sales-card\s*\{[^}]*background:\s*var\(--surface\);/);
        expect(source).toContain('overflow-wrap: anywhere');
        expect(source).toContain('min-height: 44px');
        expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|background:\s*white|backdrop-filter|transition:\s*all/i);
    });

    it('lets mobile hero content grow around an accessible primary action without backdrop blur', () => {
        const source = stylesheet('../../storefront-content-plugin/src/shared/hero-scene.css');
        expect(source).toMatch(/\.hero-rich-content\s*\{[^}]*position:\s*relative;/);
        expect(source).toMatch(
            /\.hero-rich-cta-btn\s*\{[^}]*min-height:\s*var\(--experience-control-min, 44px\);/,
        );
        expect(source).not.toContain('backdrop-filter');
    });

    it('keeps lazy route styling with the page that loads it', () => {
        const accountSecurity = stylesheet('./styles/account-security.css');
        const search = stylesheet('./styles/search-surfaces.css');
        const product = stylesheet('./styles/product-detail-surfaces.css');
        const logistics = stylesheet('./styles/logistics.css');
        const addresses = stylesheet('./styles/address-surfaces.css');
        const checkout = stylesheet('./styles/checkout-payment-surfaces.css');

        expect(accountSecurity).not.toContain('.search-page');
        expect(accountSecurity).not.toContain('.product-detail-page');
        expect(search).toContain('.search-page .search-sort');
        expect(product).toContain(
            '.product-detail-page :is(.detail-summary, .detail-options, .detail-description)',
        );
        expect(logistics).not.toContain('.address-card');
        expect(addresses).toContain('.address-card');
        expect(checkout).toContain('.checkout-address-loading');
    });

    it('pairs the unillustrated auth hero surface with readable skin text', () => {
        const auth = stylesheet('./styles/auth-flow.css');
        const rule = auth.match(
            /\.auth-page:not\(\.auth-page-managed\):not\(\.auth-page-has-image\) \.auth-hero\s*\{([^}]+)\}/,
        )?.[1];
        expect(rule).toContain('--auth-hero-overlay-color: var(--soft);');
        expect(rule).toContain('--auth-hero-text-color: var(--text);');
        expect(rule).toContain('background: var(--soft);');
    });

    it('uses readable emphasis for every price and sizes the actual card price markup', () => {
        const source = stylesheet('./styles.css');
        expect(source).toMatch(/\.price-lockup\s*\{[^}]*color:\s*var\(--accent-ink\);/);
        for (const part of ['symbol', 'decimal']) {
            const block = source.match(
                new RegExp('\\.price-lockup \\.price-' + part + '\\s*\\{([^}]+)\\}'),
            )?.[1];
            expect(block).toBeDefined();
            expect(block).not.toContain('opacity');
        }
        const card = stylesheet('./styles/product-card.css');
        expect(card).toMatch(/\.product-card-price \.price-lockup\s*\{[^}]*font-size:\s*18px;/);
        expect(card).not.toContain('.product-card-price b');
    });

    it('preserves approved desktop account workbenches without hiding checkout address actions', () => {
        const pages = stylesheet('./styles/desktop-pages.css');
        expect(pages).toMatch(/\.cart-commerce-layout\s*\{[^}]*display:\s*grid;/);
        expect(pages).toMatch(/\.cart-summary-panel\s*\{[^}]*position:\s*sticky;/);
        expect(pages).toContain('.desktop-account-workbench-toolbar');
        expect(pages).toContain('.address-workbench-toolbar');
        expect(pages).toMatch(
            /\.desktop-store-layout\s+\.desktop-account-layout\s+\.addresses-page:has\(\.address-workbench-toolbar\)\s+> \.subpage-header/,
        );
        expect(pages).not.toContain('.addresses-page > .subpage-header');
        const addresses = stylesheet('./addresses-page.tsx');
        expect(addresses).toContain("className={selection ? undefined : 'account-mobile-header-action'}");
        const account = stylesheet('./pages/desktop-account-page.tsx');
        expect(account).toMatch(
            /className="desktop-member-summary"[\s\S]*className="desktop-account-continue"[\s\S]*<\/section>/,
        );
        expect(account).not.toContain('className="desktop-account-heading"');
    });
});

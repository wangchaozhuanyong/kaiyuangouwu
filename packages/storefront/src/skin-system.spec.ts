import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { storefrontVisualPresets } from '../../storefront-content-plugin/src/visual-presets';

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
    it('gives shared empty states one appearance owner instead of route and desktop overrides', () => {
        const violations: string[] = [];
        for (const file of readdirSync(path.join(__dirname, 'styles')).filter(name =>
            name.endsWith('.css'),
        )) {
            if (['state-surfaces.css', 'semantic-icons.css'].includes(file)) continue;
            postcss.parse(stylesheet(`./styles/${file}`)).walkRules(rule => {
                if (!/\.empty-state(?:[\s.:[>,-]|$)/u.test(rule.selector)) return;
                rule.walkDecls(declaration => {
                    // Parents may place a state in a grid or remove an outer margin, never repaint it.
                    if (!['grid-column', 'width', 'margin-block'].includes(declaration.prop)) {
                        violations.push(`${file}: ${rule.selector}: ${declaration.prop}`);
                    }
                });
            });
        }
        expect(violations).toEqual([]);
        for (const file of [
            'addresses-page.tsx',
            'order-pages.tsx',
            'payment-pages.tsx',
            'checkout-page.tsx',
            'account-security-page.tsx',
            'review-pages.tsx',
        ]) {
            expect(stylesheet(`./${file}`)).not.toMatch(/function (?:Review)?EmptyState\(/u);
        }
        const states = stylesheet('./styles/state-surfaces.css');
        expect(states).not.toMatch(/#[\da-f]{3,8}\b|\bwhite\b|!important/iu);
        expect(states).toContain('var(--experience-control-min)');
        expect(states).toContain('var(--accent-foreground)');
        expect(states).toContain('var(--skin-control-radius)');
    });

    it('keeps coupon appearance out of desktop layout and unrelated global styles', () => {
        for (const file of ['desktop-pages.css', 'ai-product-covers.css', 'visual-presets.css']) {
            expect(stylesheet(`./styles/${file}`)).not.toMatch(/\.coupon-(?:center|activity)-/u);
        }
        expect(stylesheet('./styles/desktop-coupon-ticket.css')).not.toMatch(/#[\da-f]{3,8}\b/iu);
        expect(stylesheet('./pages/coupon-center-page.tsx')).not.toContain(
            'coupon-center-instructions coupon-center-guide',
        );
    });

    it('owns transparent decorative icons globally without page or skin frames', () => {
        const owner = stylesheet('./styles/semantic-icons.css');
        const slots = owner
            .slice(owner.indexOf(':is(') + 4, owner.indexOf(') {'))
            .split(',')
            .map(value => value.trim());
        const classes = slots.filter(value => /^\.[\w-]+$/u.test(value));
        const violations: string[] = [];
        for (const file of readdirSync(path.join(__dirname, 'styles'))
            .filter(name => name.endsWith('.css') && name !== 'semantic-icons.css')
            .map(name => `./styles/${name}`)
            .concat('./styles.css')) {
            postcss.parse(stylesheet(file)).walkRules(rule => {
                const icon =
                    classes.some(value => new RegExp(`\\${value}(?![\\w-])`).test(rule.selector)) ||
                    /\.(account-order-shortcuts|account-service-grid)\s*>\s*button(?:\[[^\]]+\])?\s*>\s*span(?:\s+svg)?$/u.test(
                        rule.selector,
                    ) ||
                    [
                        '.account-logistics-empty > svg',
                        '.desktop-account-support > svg:first-child',
                        '.payment-method-list label > svg:first-of-type',
                        '.ai-studio-settlement-refund > svg',
                    ].some(value => rule.selector.endsWith(value));
                if (!icon) return;
                rule.walkDecls(declaration => {
                    if (
                        /^(background(?:-.+)?|border(?:-.+)?|box-shadow|backdrop-filter)$/u.test(
                            declaration.prop,
                        )
                    ) {
                        violations.push(`${file}: ${rule.selector}: ${declaration.prop}`);
                    }
                });
            });
        }
        expect(violations).toEqual([]);
        expect(owner).toContain('background: transparent;');
        expect(owner).toContain('border-radius: 0;');
        expect(owner).toContain('width: 24px;');
        expect(owner).not.toContain('!important');
    });

    it('rejects decorative separators throughout client CSS, utility maps and components', () => {
        const files: string[] = [];
        const visit = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(file);
                else if (/\.(?:css|tsx?)$/.test(file) && !/\.spec\.|routeTree\.gen/.test(file)) {
                    files.push(file);
                }
            }
        };
        visit(__dirname);
        visit(path.resolve(__dirname, '../../storefront-content-plugin/src/shared'));
        const findings: string[] = [];
        for (const file of files) {
            const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            if (file.endsWith('.css')) {
                for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                    for (const declaration of body.split(';')) {
                        const border = declaration.match(
                            /^\s*border-(top|bottom|left|right|block|inline)(?:-(?:start|end))?(?:-width)?\s*:\s*(.+)$/,
                        );
                        if (!border || /^(?:0(?:px)?|none)(?:\s|$)/.test(border[2].trim())) continue;
                        // The quantity stepper's seams identify its editable value between +/- controls.
                        if (
                            selector.trim() === '.detail-quantity-controls output' &&
                            border[1] === 'inline'
                        ) {
                            continue;
                        }
                        // User-requested reading separators between unframed product rows.
                        if (
                            file === path.join(__dirname, 'styles/product-row.css') &&
                            selector.trim() === '.product-row + .product-row' &&
                            border[1] === 'top' &&
                            border[2].trim() === '1px solid var(--skin-divider)'
                        ) {
                            continue;
                        }
                        // Approved compact cart rows need one shallow reading separator.
                        if (
                            file === path.join(__dirname, 'styles/desktop-pages.css') &&
                            selector.trim() === '.desktop-cart-row + .desktop-cart-row' &&
                            border[1] === 'top' &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        ) {
                            continue;
                        }
                        findings.push(`${file}: ${selector.trim()} ${declaration.trim()}`);
                    }
                    const thinWidth = /(?:^|;)\s*width:\s*[1-4]px\s*;/.test(body);
                    const thinHeight = /(?:^|;)\s*height:\s*[1-4]px\s*;/.test(body);
                    if (
                        (thinWidth || thinHeight) &&
                        !(thinWidth && thinHeight) &&
                        /(?:^|;)\s*background(?:-color)?:/.test(body) &&
                        !/display:\s*none|content:\s*none/.test(body) &&
                        !new Set([
                            // The active search sort underline identifies the selected control.
                            '.search-sort > button.is-active::after',
                            '.price-range-inputs > i',
                            '.page-readiness-progress',
                            '.route-transition-track',
                            '.ai-generation-progress progress',
                        ]).has(selector.trim())
                    ) {
                        findings.push(`${file}: ${selector.trim()} draws a thin background divider`);
                    }
                }
            } else {
                const utilityBorders = source.matchAll(
                    /\[border-(?:top|bottom|left|right|block|inline)(?:-(?:start|end))?:([^\]]+)\]/g,
                );
                for (const match of utilityBorders) {
                    if (!/^(?:0|none)$/.test(match[1])) findings.push(`${file}: ${match[0]}`);
                }
                for (const match of source.matchAll(
                    /(?:^|[\s"'`])((?:[a-z-]+:)*(?:divide-[xy](?:-\d+)?|border-[tblrxy](?:-\d+)?))(?=[\s"'`])/g,
                )) {
                    if (!/-0$/.test(match[1])) findings.push(`${file}: ${match[1]}`);
                }
                for (const match of source.matchAll(
                    /(?:^|[\s"'`])((?:[a-z-]+:)*(?:[hw]-px|[hw]-\[[12]px\]|\[(?:height|width):[12]px\]))(?=[\s"'`])/g,
                )) {
                    findings.push(`${file}: ${match[1]} draws a thin utility divider`);
                }
                for (const match of source.matchAll(
                    /border(?:Top|Bottom|Left|Right)(?:Width)?\s*:\s*(['"])([^'"]+)\1/g,
                )) {
                    if (!/^(?:0(?:px)?|none)(?:\s|$)/.test(match[2])) findings.push(`${file}: ${match[0]}`);
                }
                if (/<hr(?:\s|\/|>)/.test(source)) findings.push(`${file}: standalone horizontal rule`);
            }
        }
        expect(findings).toEqual([]);
    });

    it('keeps one page header implementation and one responsive spacing owner', () => {
        const visit = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(file);
                else if (/\.tsx?$/.test(file) && !/\.spec\.|routeTree\.gen/.test(file)) {
                    if (file === path.join(__dirname, 'storefront-ui/page-shell.tsx')) continue;
                    expect(readFileSync(file, 'utf8'), file).not.toMatch(
                        /function\s+(?:SubHeader|Subpage)\(/,
                    );
                } else if (
                    file.endsWith('.css') &&
                    file !== path.join(__dirname, 'styles/subpage-content.css')
                ) {
                    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
                    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                        if (
                            !selector.trim().endsWith('.subpage-header') ||
                            selector.includes('.product-detail-page')
                        )
                            continue;
                        expect(body, `${file}: ${selector}`).not.toMatch(
                            /(?:^|;)\s*(?:height|min-height|margin|padding(?:-top)?):/,
                        );
                    }
                }
            }
        };
        visit(__dirname);
        expect(stylesheet('./styles/subpage-content.css')).toMatch(
            /\.desktop-store-layout \.page\.subpage > \.subpage-header\s*\{[^}]*height:\s*auto;/,
        );
        expect(stylesheet('./styles/home-showcase.css')).not.toMatch(
            /\.category-navigation-shell > \.topbar\.category-topbar\s*\{[^}]*padding-top:\s*72px;/,
        );
    });

    it('allows only root token declarations in the skin adapter, never component or responsive overrides', () => {
        const source = stylesheet('./styles/visual-presets.css').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(source).not.toMatch(/@|!important|--color-/);
        const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        const expectedSelectors = [
            'html[data-storefront-preset]',
            ...storefrontVisualPresets
                .filter(preset => preset.id !== 'classic')
                .map(preset => `html[data-storefront-preset='${preset.id}']`),
        ];
        expect(rules.map(([, selector]) => selector.trim()).sort()).toEqual(expectedSelectors.sort());
        for (const [, , body] of rules) {
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

    it('keeps cart surfaces in their owner with shallow separators only between merchandise rows', () => {
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
        expect(stylesheet('./styles/desktop-pages.css')).toMatch(
            /\.desktop-cart-product\s*\{[^}]*grid-row:\s*1 \/ span 2;/,
        );
        expect(stylesheet('./styles/desktop-pages.css')).toMatch(
            /\.desktop-cart-row\s*\+\s*\.desktop-cart-row\s*\{[^}]*border-top:\s*1px solid var\(--line-subtle\);/,
        );
        const accountAssets = stylesheet('./styles/account-identity.css').match(
            /\.account-identity-assets\s*\{([^}]*)\}/,
        )?.[1];
        expect(accountAssets).not.toContain('border-top:');
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
        expect(card).toMatch(/\.product-card-media\s*\{[^}]*border-radius:\s*0;/);
        expect(card).toMatch(/\.product-card\s*\{[^}]*overflow:\s*hidden;[^}]*padding:\s*0;/);
        expect(card).toMatch(
            /\.product-card-content\s*\{[^}]*padding:\s*0 var\(--product-card-inset\) var\(--product-card-inset\);/,
        );
    });

    it('gives transparent product rows one owner and preserves square art with reading separators', () => {
        for (const file of [
            'home-showcase',
            'ai-product-covers',
            'desktop-layout',
            'auth-flow',
            'search-surfaces',
        ]) {
            expect(stylesheet(`./styles/${file}.css`), file).not.toMatch(/\.product-row(?:[\s.{:#>-]|$)/);
        }
        const row = stylesheet('./styles/product-row.css');
        expect(row).toContain('aspect-ratio: var(--product-media-ratio)');
        expect(row).toContain('object-fit: contain');
        expect(row).toMatch(/\.product-row\s*\{[^}]*background:\s*transparent;/);
        expect(row).toMatch(
            /\.product-row\s*\{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/,
        );
        expect(row).not.toMatch(/border-bottom|#[0-9a-f]{3,8}\b|!important/);
        expect(row).toMatch(/\.product-row-name\s*\{[^}]*overflow-wrap:\s*anywhere;/);
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

    it('fills the carousel frame for every theme without reintroducing original-image letterboxing', () => {
        const source = stylesheet('../../storefront-content-plugin/src/shared/hero-scene.css');
        const imageRules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
            ([, selector]) =>
                selector.includes('.hero.hero-image-overlay') && selector.includes('.hero-rich-backdrop'),
        );
        expect(imageRules.length).toBeGreaterThan(0);
        for (const [, , declarations] of imageRules) {
            if (declarations.includes('object-fit:')) expect(declarations).toContain('object-fit: cover;');
        }
        expect(source).toMatch(
            /\.hero\.hero-image-overlay \.hero-rich-image-link,\s*\.hero\.hero-image-overlay \.safe-image-frame\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/,
        );
        expect(source).toMatch(
            /\.hero\.hero-image-overlay \.hero-rich-content\s*\{[^}]*background:\s*transparent;/,
        );
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
        expect(pages).not.toContain('.addresses-page > .subpage-header');
        const addresses = stylesheet('./addresses-page.tsx');
        expect(addresses).toContain("actionVisibility={selection ? 'all' : 'mobile'}");
        const account = stylesheet('./pages/desktop-account-page.tsx');
        expect(account).toContain('<AccountIdentity');
        expect(account).toContain('className="desktop-account-orders"');
        expect(account).not.toContain('className="desktop-account-heading"');
    });
});

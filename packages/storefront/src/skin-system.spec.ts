import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { resolveStorefrontSkinTreatment } from '../../storefront-content-plugin/src/shared/storefront-semantic-palette';
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
    it('prevents neutral borders from inheriting dark text throughout the storefront', () => {
        for (const file of ['./styles.css', '../two-factor-tool/styles.css']) {
            const css = postcss.parse(stylesheet(file));
            const baseDefaults: string[] = [];
            css.walkAtRules('layer', layer => {
                if (layer.params !== 'base') return;
                layer.walkRules(rule => {
                    if (!rule.selectors.includes('*')) return;
                    expect(rule.selectors).toEqual(['*', '::before', '::after', '::backdrop']);
                    rule.walkDecls('border-color', declaration => {
                        baseDefaults.push(declaration.value);
                    });
                });
            });
            expect(baseDefaults).toEqual(['var(--line-subtle, var(--line))']);
        }

        const violations: string[] = [];
        const iconStrokes = new Set([
            'styles.css|.btn-spinner',
            'styles/skeletons.css|.page-loading-spinner',
            'styles/image-studio-desktop.css|.ai-studio-desktop-ratios i',
        ]);
        const visit = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    visit(file);
                    continue;
                }
                if (!/\.(?:css|tsx?)$/u.test(file) || /\.spec\.|routeTree\.gen/u.test(file)) continue;
                const relative = path.relative(__dirname, file);
                const source = readFileSync(file, 'utf8');
                if (file.endsWith('.css')) {
                    postcss.parse(source).walkDecls(declaration => {
                        if (
                            !/^border(?:$|-)/u.test(declaration.prop) ||
                            /radius|width|style/u.test(declaration.prop)
                        )
                            return;
                        const selector = (declaration.parent as postcss.Rule).selector;
                        if (iconStrokes.has(`${relative}|${selector}`)) return;
                        // Translucent text mixes and state colors remain intentional; opaque text is never a neutral edge.
                        if (
                            /currentcolor|var\(--line-strong\)/iu.test(declaration.value) ||
                            /(?:^|solid\s+)var\(--(?:text|muted)\)$/u.test(declaration.value)
                        ) {
                            violations.push(`${relative}:${declaration.source?.start?.line}: ${selector}`);
                        }
                    });
                } else if (/border[^\s'"`]*\[var\(--(?:line-strong|text|muted)\)\]/u.test(source)) {
                    violations.push(`${relative}: opaque text or strong border utility`);
                }
            }
        };
        visit(__dirname);
        visit(path.resolve(__dirname, '../../storefront-content-plugin/src/shared'));
        visit(path.resolve(__dirname, '../two-factor-tool'));
        expect(
            violations,
            'Use --line for controls and --line-subtle / --skin-divider for reading separators.',
        ).toEqual([]);
    });

    it('preserves the approved sidebar identity palette independently of skins', () => {
        const css = postcss.parse(stylesheet('./styles/desktop-commerce.css'));
        const tokens = new Map<string, string>();
        css.walkRules(".desktop-account-profile[data-identity-theme='mist']", rule => {
            rule.walkDecls(declaration => {
                tokens.set(declaration.prop, declaration.value);
            });
        });
        expect(tokens.get('--identity-surface')).toBe('#f4f7fb');
        expect(tokens.get('--identity-text')).toBe('#243247');
        expect(tokens.get('--identity-muted')).toBe('#66758a');
        expect(stylesheet('./components/common/desktop-account-navigation.tsx')).toContain(
            'data-identity-theme="mist"',
        );
    });

    it('reserves the same classic border before and after theme hydration', () => {
        const css = presetRootBlock(stylesheet('./styles/visual-presets.css'), 'classic');
        expect(css).toContain(
            `--skin-card-outline: ${resolveStorefrontSkinTreatment('classic').cardOutline};`,
        );
    });

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

    it('keeps notification and referral geometry in their responsive owners', () => {
        for (const file of ['account-catalog-surfaces.css', 'desktop-pages.css', 'visual-presets.css']) {
            expect(stylesheet(`./styles/${file}`)).not.toMatch(
                /\.(notification|referral|desktop-referral)-/u,
            );
        }
        for (const page of ['notifications', 'referral']) {
            const css = stylesheet(`./styles/${page}.css`);
            expect(css).not.toMatch(/!important|data-storefront-preset/iu);
            // REFERRAL_CELEBRATION_20261002: only the approved local theme may own fixed colors.
            postcss.parse(css).walkDecls(declaration => {
                if (!/#[\da-f]{3,8}\b/iu.test(declaration.value)) return;
                expect(page).toBe('referral');
                expect(declaration.prop).toMatch(/^--/u);
                expect((declaration.parent as postcss.Rule).selector).toBe(
                    ".desktop-referral-content[data-referral-theme='celebration']",
                );
            });
            expect(stylesheet(`./pages/${page}-page.tsx`)).toContain(`../styles/${page}.css`);
        }
    });

    it('preserves the approved referral campaign palette independently of storefront skins', () => {
        const css = postcss.parse(stylesheet('./styles/referral.css'));
        const tokens = new Map<string, string>();
        css.walkRules(".desktop-referral-content[data-referral-theme='celebration']", rule => {
            rule.walkDecls(declaration => {
                tokens.set(declaration.prop, declaration.value);
            });
        });
        // These approved campaign roles must not be replaced with store/skin-derived values.
        expect(tokens.get('--accent')).toBe('#b92f32');
        expect(tokens.get('--surface')).toBe('#fffdf9');
        expect(tokens.get('--referral-gold')).toBe('#ffe0a0');
        expect(tokens.get('--skin-card-radius')).toBe('22px');
        expect([...tokens.values()].join(' ')).not.toContain('var(');
        expect(stylesheet('./pages/referral-page.tsx')).toContain('data-referral-theme="celebration"');
    });

    it('preserves directory B without overriding the active storefront skin', () => {
        const selector = ".business-services-page[data-services-layout='directory-b']";
        const css = postcss.parse(stylesheet('./pages/business-services-page.css'));
        css.walkDecls(declaration => {
            expect(declaration.value).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/iu);
            expect(declaration.prop).not.toMatch(
                /^--(?:bg|paper|surface|text|muted|accent|focus|line|control|skin)(?:-|$)/u,
            );
        });
        expect(stylesheet('./pages/business-services-page.tsx')).toContain(
            'data-services-layout="directory-b"',
        );
        const icons = postcss.parse(stylesheet('./styles/semantic-icons.css'));
        const grounds: string[] = [];
        icons.walkRules(rule => {
            if (!rule.selector.includes('data-services-layout')) return;
            rule.walkDecls('background', declaration => {
                expect(rule.selector).toBe(`${selector} .is-tools .category-client-plugin-icon`);
                grounds.push(declaration.value);
            });
        });
        expect(grounds).toEqual(['var(--control-surface)']);
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

    it('limits reading separators to approved adjacent rows and summary groups', () => {
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
                        // Approved functional-row redesign: only adjacent rows and the total boundary.
                        const functionalSeparators = [
                            'styles/auth-flow.css|.auth-page .auth-assurance-rail',
                            'styles/account-catalog-surfaces.css|.account-page .account-recent-purchases > div > article + article::before',
                            'styles/account-security.css|.security-card-list > :is(.security-item-btn, .security-item-static)' +
                                ' + :is(.security-item-btn, .security-item-static)::before',
                            'styles/address-surfaces.css|.address-card + .address-card::before',
                            'styles/checkout-payment-surfaces.css|.price-summary .summary-total',
                            'styles/logistics.css|.delivery-table tr + tr',
                            'styles/notifications.css|.notification-list > button + button::before',
                            'styles/order-aftercare.css|.order-detail-products article + article::before',
                            'styles/order-aftercare.css|.order-logistics-item + .order-logistics-item',
                        ];
                        const functionalKey = `${path.relative(__dirname, file)}|${selector.trim().replace(/\s+/g, ' ')}`;
                        if (
                            border[1] === 'top' &&
                            functionalSeparators.includes(functionalKey) &&
                            border[2].trim() === '1px solid var(--skin-divider)'
                        ) {
                            continue;
                        }
                        // User-approved centered referral totals have one campaign-colored divider.
                        if (
                            functionalKey === 'styles/referral.css|.referral-reward-totals::before' &&
                            border[1] === 'inline' &&
                            border[2].trim() === '1px solid var(--line)'
                        ) {
                            continue;
                        }
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
                        // Product details and verified reviews use skin-toned reading separators.
                        if (
                            [
                                'styles/product-detail-surfaces.css|.detail-params dl > div|bottom',
                                'styles/product-detail-surfaces.css|.detail-empty-review|top',
                                'styles/ai-product-covers.css|.review-candidate-row + .review-candidate-row|top',
                                'styles/ai-product-covers.css|.my-review-list article + article|top',
                                'styles/ai-product-covers.css|.product-review-list article + article|top',
                                'styles/ai-product-covers.css|.product-review-list blockquote|top',
                                'styles/ai-product-covers.css|.my-review-list blockquote|top',
                            ].some(
                                rule =>
                                    rule ===
                                    `${path.relative(__dirname, file)}|${selector.trim()}|${border[1]}`,
                            ) &&
                            border[2].trim() ===
                                '1px solid color-mix(in srgb, var(--skin-divider) 75%, transparent)'
                        ) {
                            continue;
                        }
                        // Delivery tables and the coupon guide retain their approved separators.
                        if (
                            ((file === path.join(__dirname, 'styles/logistics.css') &&
                                selector.trim() === '.delivery-table td' &&
                                border[1] === 'bottom') ||
                                (file === path.join(__dirname, 'styles/coupon-center.css') &&
                                    selector.trim() === '.coupon-center-guide dl > div + div' &&
                                    border[1] === 'inline')) &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        )
                            continue;
                        // Layout B's shared tool directory separates adjacent actionable rows.
                        if (
                            file === path.join(__dirname, 'styles/service-entries.css') &&
                            selector.trim() ===
                                '.is-tools .category-client-plugin + .category-client-plugin' &&
                            border[1] === 'top' &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        ) {
                            continue;
                        }
                        // ACCOUNT_READING_SURFACES_20261002: approved recent-order reading separators.
                        if (
                            file === path.join(__dirname, 'styles/desktop-commerce.css') &&
                            selector.trim() === '.desktop-recent-orders article + article' &&
                            border[1] === 'top' &&
                            border[2].trim() === '1px solid var(--line-subtle)'
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
                        // Product buying details use the shared weak divider between reading groups.
                        if (
                            file === path.join(__dirname, 'styles/desktop-pages.css') &&
                            [
                                '.desktop-product-buying .detail-price-line|bottom',
                                '.desktop-product-buying .detail-service-bar|top',
                            ].includes(`${selector.trim()}|${border[1]}`) &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        ) {
                            continue;
                        }
                        // The confirmed mobile detail design separates quantity controls and service facts.
                        if (
                            file === path.join(__dirname, 'styles/product-detail-surfaces.css') &&
                            [
                                '.detail-quantity .quantity-control > button + output, .detail-quantity .quantity-control > output + button',
                                '.product-detail-page .detail-service-bar span + span',
                            ].includes(selector.trim().replace(/\s+/g, ' ')) &&
                            border[1] === 'left' &&
                            border[2].trim() === '1px solid var(--skin-divider)'
                        ) {
                            continue;
                        }
                        // Category directory, nesting and rows use subtle seams to clarify navigation.
                        if (
                            file === path.join(__dirname, 'styles/desktop-commerce.css') &&
                            [
                                '.desktop-category-directory-title|bottom',
                                '.desktop-catalog-sidebar .desktop-subcategory-sidebar|left',
                                '.desktop-category-navigation .desktop-local-navigation > button, .desktop-category-navigation .desktop-category-entry|bottom',
                                '.desktop-subcategory-sidebar nav > button|bottom',
                            ].includes(`${selector.trim().replace(/\s+/g, ' ')}|${border[1]}`) &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        ) {
                            continue;
                        }
                        // The approved account B design separates shortcuts using the current skin's divider.
                        if (
                            file === path.join(__dirname, 'styles/account-identity.css') &&
                            selector.trim() === '.account-identity-assets > button + button' &&
                            border[1] === 'left' &&
                            border[2].trim() === '1px solid var(--line-subtle)'
                        ) {
                            continue;
                        }
                        // User-requested support contact groups share one subtle reading rule.
                        if (
                            file === path.join(__dirname, 'styles/modals-and-support.css') &&
                            selector.trim().replace(/\s+/g, ' ') ===
                                '.support-hours-card + .support-channel-list::before, ' +
                                    '.support-channel-list + .support-contact-note::before, ' +
                                    '.support-channel-row + .support-channel-row::before' &&
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
                            // Functional active-state marker in the narrow category rail.
                            '.category-subcat-sidebar .subcat-side-item.is-active::before',
                            // Desktop selection indicator; hidden on unselected category rows.
                            '.desktop-subcategory-sidebar nav > button::before',
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

    it('prevents route containers from reintroducing shared page insets and stacked section margins', () => {
        const violations: string[] = [];
        const roots =
            /\.(?:subpage-body|support-center-content|security-page-body|desktop-referral-content|delivery-overview|delivery-detail-page)$/u;
        const cards =
            /\.(?:support-contact-panel|support-faq-card|support-evaluation-card|coupon-center-workspace|coupon-center-guide)$/u;
        for (const file of readdirSync(path.join(__dirname, 'styles')).filter(name =>
            name.endsWith('.css'),
        )) {
            if (file === 'subpage-content.css') continue;
            postcss.parse(stylesheet(`./styles/${file}`)).walkRules(rule => {
                const isRoot = rule.selectors.some(selector => roots.test(selector.trim()));
                const isCard = rule.selectors.some(selector => cards.test(selector.trim()));
                rule.walkDecls(declaration => {
                    const prop = declaration.prop;
                    if (isRoot && /^(?:padding(?:-.+)?|gap|row-gap)$/u.test(prop)) {
                        violations.push(`${file}: ${rule.selector}: ${prop}`);
                    }
                    if (
                        (isRoot || isCard) &&
                        /^(?:margin|margin-block(?:-.+)?|margin-top|margin-bottom)$/u.test(prop) &&
                        !/^0(?:px)?$/u.test(declaration.value)
                    ) {
                        violations.push(`${file}: ${rule.selector}: ${prop}`);
                    }
                });
            });
        }
        expect(violations).toEqual([]);
    });

    it('keeps one page header implementation and one responsive spacing owner', () => {
        const visit = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(file);
                else if (/\.tsx?$/.test(file) && !/\.spec\.|routeTree\.gen/.test(file)) {
                    if (file === path.join(__dirname, 'storefront-ui/page-shell.tsx')) continue;
                    expect(readFileSync(file, 'utf8'), file).not.toMatch(
                        /function\s+(?:SubHeader|Subpage|SubpageBody)\(/,
                    );
                } else if (
                    file.endsWith('.css') &&
                    file !== path.join(__dirname, 'styles/subpage-content.css')
                ) {
                    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
                    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                        if (
                            !selector.includes('.subpage-header') ||
                            selector.includes('.product-detail-page')
                        )
                            continue;
                        const ownsHeader = /\.subpage-header(?:\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*\s*$/u.test(
                            selector,
                        );
                        const ownsTitle =
                            /\.subpage-header(?:\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*\s*>\s*strong\b/u.test(
                                selector,
                            );
                        if (ownsHeader) {
                            expect(body, `${file}: ${selector}`).not.toMatch(
                                /(?:^|;)\s*(?:height|min-height|margin|padding(?:-top)?):/,
                            );
                        }
                        if (ownsHeader || ownsTitle) {
                            expect(body, `${file}: ${selector}`).not.toMatch(
                                /(?:^|;)\s*(?:font-size|font-weight|line-height):/,
                            );
                        }
                    }
                }
            }
        };
        visit(__dirname);
        expect(stylesheet('./styles/subpage-content.css')).toMatch(
            /\.desktop-store-layout \.page\.subpage > \.subpage-header\s*\{[^}]*height:\s*auto;/,
        );
        expect(stylesheet('./styles/subpage-content.css')).toMatch(
            /\.desktop-store-layout \.subpage-header > strong\s*\{[^}]*font-size:\s*var\(--type-topbar-size\);[^}]*line-height:\s*var\(--type-topbar-leading\);/,
        );
        expect(stylesheet('./tailwind/checkout-page-styles.ts')).not.toContain('[&>.subpage-header]');
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
            ...storefrontVisualPresets.map(preset => `html[data-storefront-preset='${preset.id}']`),
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
        expect(stylesheet('./styles/desktop-pages.css')).not.toContain('.desktop-store-layout .cart-topbar');
    });

    it('keeps cart surfaces in their owner with shallow separators only between merchandise rows', () => {
        const layout = stylesheet('./styles/desktop-layout.css');
        const skin = stylesheet('./styles/visual-presets.css').split('@media (max-width: 1023px)')[0];
        expect(layout).not.toMatch(/\.cart-group\s*[,\{]/);
        expect(skin).not.toContain('.cart-group');
        expect(stylesheet('./styles/cart-layout.css')).toMatch(
            /\.cart-group\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*border:\s*var\(--skin-card-outline, 0\);/,
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
        expect(stylesheet('./styles/account-catalog-surfaces.css')).toMatch(
            /\.account-page \.account-section\s*\{[^}]*border:\s*var\(--skin-card-outline, 0\);/,
        );
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
        // Account B replaces the former blue exception: prevent fixed colors returning on skin changes.
        expect(stylesheet('./styles/account-identity.css')).not.toMatch(
            /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|data-storefront-preset|!important/iu,
        );
        const source = stylesheet('./styles/visual-presets.css');
        const lineOwners = new Set([
            'styles/experience-foundations.css',
            // User-approved local campaign and service themes retain their boundaries.
            'styles/referral.css',
            'pages/business-services-page.css',
        ]);
        const visitLineOwners = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) visitLineOwners(file);
                else if (file.endsWith('.css') && !lineOwners.has(path.relative(__dirname, file))) {
                    postcss.parse(readFileSync(file, 'utf8')).walkDecls(declaration => {
                        expect(declaration.prop, file).not.toBe('--line');
                        expect(declaration.prop, file).not.toBe('--line-strong');
                        expect(declaration.prop, file).not.toBe('--focus');
                    });
                }
            }
        };
        visitLineOwners(__dirname);
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

        for (const presetId of ['neo-minimalist']) {
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
        const primaryAction = controls.match(
            /:is\(\.primary-action, \.order-btn\.primary-btn\)\s*\{([^}]+)\}/,
        )?.[1];
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

    it('gives transparent product rows one owner and preserves media with reading separators', () => {
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
        expect(row).toMatch(
            /\.product-row-name\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/,
        );
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

        expect(source).toMatch(/\.security-avatar-actions button\s*\{[^}]*color:\s*var\(--accent-ink\);/);
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
        expect(source).toMatch(/\.review-composer textarea\s*\{[^}]*background:\s*var\(--surface\);/);
        expect(source).toMatch(/\.review-submit\s*\{[^}]*color:\s*var\(--accent-foreground\);/);
        expect(source).toMatch(/\.review-rating-input button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
        expect(source).toMatch(/\.review-state.is-approved\s*\{[^}]*var\(--success\)/);
        expect(source).toMatch(/\.product-review-list article\s*\{[^}]*overflow-wrap:\s*anywhere;/);
        expect(source).toMatch(/\.review-composer textarea\s*\{[^}]*border:\s*1px solid var\(--line\);/);
        expect(source).toContain('outline: var(--experience-focus-width) solid var(--focus);');
    });

    it('keeps panel headings and non-review lists free of decorative rules across component and layout owners', () => {
        const borderlessSelectors = [
            '.section-header',
            '.review-composer-summary',
            '.my-review-list article',
            '.product-review-list article',
            '.coupon-center-cart-link',
            '.payment-summary > header',
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

    it('uses skin dividers and no gray row fills for product details and reviews', () => {
        const detail = stylesheet('./styles/product-detail-surfaces.css');
        const review = stylesheet('./styles/ai-product-covers.css');
        expect(detail).toMatch(
            /\.detail-params dl > div\s*\{[^}]*border-bottom: 1px solid color-mix\(in srgb, var\(--skin-divider\)/,
        );
        expect(detail).not.toMatch(/\.product-detail-page \.detail-params dl > div\s*\{[^}]*background:/);
        expect(detail).toMatch(
            /\.detail-empty-review\s*\{[^}]*border-top: 1px solid color-mix\(in srgb, var\(--skin-divider\)/,
        );
        expect(detail).not.toMatch(/\.detail-empty-review\s*\{[^}]*background:/);
        expect(review).toMatch(/\.product-review-list article \+ article\s*\{[^}]*var\(--skin-divider\)/);
        expect(review).toMatch(/\.review-candidate-row\s*\{[^}]*background: transparent;/);
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

    it('keeps uploaded carousel artwork complete and lets phone copy follow its native ratio', () => {
        const source = stylesheet('../../storefront-content-plugin/src/shared/hero-scene.css');
        const imageRules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
            ([, selector]) =>
                selector.includes('.hero.hero-image-overlay') && selector.includes('.hero-rich-backdrop'),
        );
        expect(imageRules.length).toBeGreaterThan(0);
        for (const [, , declarations] of imageRules) {
            if (declarations.includes('object-fit:')) expect(declarations).toContain('object-fit: contain;');
            expect(declarations).toContain('height: auto;');
        }
        expect(source).toMatch(
            /\.hero\.hero-image-overlay \.hero-rich-image-link,\s*\.hero\.hero-image-overlay \.safe-image-frame\s*\{[^}]*position:\s*relative;[^}]*inset:\s*auto;/,
        );
        expect(source).toMatch(
            /\.hero\.hero-image-overlay \.hero-rich-content\s*\{[^}]*background:\s*transparent;/,
        );
        expect(source).toMatch(/\.hero\.hero-image-overlay \.hero-rich-content\s*\{[^}]*max-height:\s*none;/);
        expect(source).toMatch(
            /data-copy-layout='below'\] \.hero-rich-content\s*\{[^}]*position:\s*relative;/,
        );
        expect(source).toMatch(
            /\.hero\.hero-image-overlay \.hero-rich-desc\s*\{[^}]*display:\s*block;[^}]*overflow:\s*visible;/,
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
        expect(card).toMatch(
            /\.product-card-price \.price-lockup\s*\{[^}]*font-size:\s*var\(--type-price-size\);/,
        );
        expect(stylesheet('./styles/experience-foundations.css')).toContain('--type-price-size: 18px;');
        expect(stylesheet('./styles/experience-foundations.css')).toContain('--type-input-size: 16px;');
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

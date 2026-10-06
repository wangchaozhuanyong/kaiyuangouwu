import { describe, expect, it } from 'vitest';

import {
    auditStorefrontSemanticPalette,
    normalizeStorefrontColor,
    resolveStorefrontSemanticPalette,
    resolveStorefrontSkinTreatment,
    semanticPaletteCssVariables,
    storefrontContrastRatio,
    storefrontSkinCssVariables,
} from './storefront-semantic-palette';

describe('storefront semantic palette', () => {
    it.each(['classic', 'neo-minimalist'] as const)(
        'separates navigation from primary actions with readable %s interaction states',
        presetId => {
            const palette = resolveStorefrontSemanticPalette(presetId);
            expect(palette.selection).not.toBe(palette.accent);
            expect(palette.interactionHover).not.toBe(palette.selection);
            expect(storefrontContrastRatio(palette.onSelection, palette.selection)).toBeGreaterThanOrEqual(
                4.5,
            );
            expect(
                storefrontContrastRatio(palette.onSelection, palette.selectionHover),
            ).toBeGreaterThanOrEqual(4.5);
            expect(
                storefrontContrastRatio(palette.interactionInk, palette.interactionHover),
            ).toBeGreaterThanOrEqual(4.5);
            expect(
                storefrontContrastRatio(palette.interactionInk, palette.interactionPressed),
            ).toBeGreaterThanOrEqual(4.5);
            expect(semanticPaletteCssVariables(palette)['--selection-foreground']).toBe(palette.onSelection);
        },
    );
    it.each(['classic', 'neo-minimalist'] as const)(
        'keeps the %s standard palette inside the contrast contract',
        presetId => {
            const audit = auditStorefrontSemanticPalette(resolveStorefrontSemanticPalette(presetId));
            expect(audit.passes).toBe(true);
            for (const name of ['subtle-muted', 'accent-soft-muted']) {
                expect(audit.checks.find(check => check.name === name)?.passes).toBe(true);
            }
        },
    );

    it.each(['classic', 'neo-minimalist'] as const)(
        'keeps every %s UI color identical across merchant branding',
        presetId => {
            const standard = resolveStorefrontSemanticPalette(presetId);
            const standardVariables = semanticPaletteCssVariables(standard);
            for (const color of [
                '#8f6c24',
                '#b91c1c',
                '#8b5cf6',
                '#000000',
                '#ffffff',
                '#777777',
                'purple',
                '',
            ]) {
                const branding = {
                    backgroundColor: color,
                    primaryColor: color,
                    accentColor: color,
                    highlightColor: '#991b1b',
                };
                const before = { ...branding };
                const palette = resolveStorefrontSemanticPalette(presetId, branding);
                expect(palette).toEqual(standard);
                expect(semanticPaletteCssVariables(palette)).toEqual(standardVariables);
                expect(auditStorefrontSemanticPalette(palette).passes).toBe(true);
                expect(branding).toEqual(before);
            }
        },
    );

    it('uses graphite actions and champagne interaction roles without changing the classic foundations', () => {
        const palette = resolveStorefrontSemanticPalette('classic');
        expect(palette).toMatchObject({
            page: '#f1f5f9',
            surface: '#ffffff',
            elevated: '#ffffff',
            subtle: '#f2f2f3',
            text: '#25292d',
            muted: '#626b75',
            brand: '#292d32',
            accent: '#292d32',
            accentHover: '#161a1e',
            accentSoft: '#f4f2ed',
            onAccent: '#ffffff',
            selection: '#735b36',
            selectionSoft: '#f4f2ed',
            focus: '#735b36',
        });
        const variables = semanticPaletteCssVariables(palette);
        expect(variables['--store-primary']).toBe(palette.accent);
        expect(variables['--brand-primary']).toBe(palette.accent);
        expect(variables['--brand-accent']).toBe(palette.accent);
        expect(variables['--brand-highlight']).toBe(palette.accentHover);
        expect(storefrontContrastRatio(palette.onAccent, palette.accentHover)).toBeGreaterThanOrEqual(4.5);
        expect(storefrontContrastRatio(palette.focus, palette.surface)).toBeGreaterThanOrEqual(3);
    });

    it('keeps each classic feature surface and action state readable without dark hero panels', () => {
        const palette = resolveStorefrontSemanticPalette('classic');
        const variables = storefrontSkinCssVariables('classic');
        expect(variables['--skin-primary-hover']).toBe('#161a1e');
        const checks = [
            ['--skin-account-ink', '--skin-account-surface'],
            ['--skin-account-muted', '--skin-account-surface'],
            ['--skin-account-emphasis', '--skin-account-surface'],
            ['--skin-account-ink', '--skin-account-hover'],
            ['--skin-account-action-ink', '--skin-account-action-surface'],
            ['--skin-account-action-hover-ink', '--skin-account-action-hover'],
            ['--skin-account-action-hover-ink', '--skin-account-action-pressed'],
            ['--skin-referral-ink', '--skin-referral-surface'],
            ['--skin-referral-muted', '--skin-referral-surface'],
            ['--skin-referral-ink', '--skin-referral-hover'],
            ['--skin-referral-ink', '--skin-referral-pressed'],
            ['--skin-referral-link-ink', '--skin-referral-link-surface'],
            ['--skin-coupon-action-ink', '--skin-coupon-tint'],
            ['--skin-coupon-action-ink', '--skin-coupon-action-surface'],
            ['--skin-coupon-action-ink', '--skin-coupon-action-hover'],
            ['--skin-coupon-action-ink', '--skin-coupon-action-pressed'],
            ['--skin-coupon-inactive-ink', '--skin-coupon-inactive-surface'],
            ['--skin-coupon-pending-ink', '--skin-coupon-pending-surface'],
            ['--navigation-foreground', '--navigation-surface'],
            ['--navigation-foreground', '--navigation-hover'],
        ];
        for (const [foreground, background] of checks) {
            expect(
                storefrontContrastRatio(variables[foreground], variables[background]),
                `${foreground} on ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
        }
        for (const name of ['--skin-account-surface', '--skin-referral-surface', '--skin-coupon-tint']) {
            expect(storefrontContrastRatio(variables[name], palette.surface), name).toBeLessThan(1.3);
        }
        expect(
            storefrontContrastRatio(palette.onAccent, variables['--accent-pressed']),
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('preserves the existing dark palette and each owner-specific feature fallback', () => {
        const palette = resolveStorefrontSemanticPalette('neo-minimalist');
        expect(palette).toEqual({
            page: '#070b14',
            surface: '#0e1421',
            elevated: '#151d2d',
            subtle: '#1b2435',
            text: '#f4f7fb',
            muted: '#a9b6c8',
            brand: '#8b5cf6',
            accent: '#6654c8',
            accentHover: '#5745b6',
            accentSoft: '#251b3b',
            accentInk: '#c4b5fd',
            onAccent: '#ffffff',
            selection: '#b9e3d7',
            selectionHover: '#d2efe6',
            onSelection: '#173e36',
            interactionHover: '#223c3c',
            interactionPressed: '#2c4d48',
            interactionInk: '#b9e3d7',
            border: '#65748a',
            borderStrong: '#8897aa',
            focus: '#a78bfa',
            success: '#41d99c',
            warning: '#f4bf63',
            danger: '#ff7d86',
        });
        const variables = storefrontSkinCssVariables('neo-minimalist');
        expect(variables).toMatchObject({
            '--skin-account-surface': palette.accent,
            '--skin-account-ink': palette.onAccent,
            '--skin-account-action-surface': palette.onAccent,
            '--skin-account-action-ink': palette.accent,
            '--skin-referral-surface': palette.accent,
            '--skin-referral-link-surface': palette.surface,
            '--skin-referral-link-ink': palette.text,
            '--navigation-surface': palette.selection,
            '--navigation-foreground': palette.onSelection,
            '--navigation-hover': palette.selectionHover,
            '--coupon-rose-ink': '#e99084',
            '--coupon-gold-ink': '#d8bc80',
            '--coupon-blue-ink': '#91bfc9',
            '--coupon-emerald-ink': '#88c8b1',
        });
        for (const token of [
            '--accent-pressed',
            '--skin-primary-hover',
            '--control-border',
            '--savings-ink',
            '--skin-coupon-tint',
            '--skin-coupon-action-surface',
            '--skin-coupon-action-hover',
            '--skin-coupon-action-pressed',
            '--skin-coupon-action-ink',
            '--skin-coupon-opacity',
            '--skin-coupon-inactive-surface',
            '--skin-coupon-inactive-ink',
            '--skin-coupon-pending-surface',
            '--skin-coupon-pending-ink',
            '--skin-coupon-focus',
        ])
            expect(variables[token], token).toBe('initial');
    });

    it('normalizes content colors without making them preset controls', () => {
        expect(normalizeStorefrontColor('')).toBeNull();
        expect(normalizeStorefrontColor('purple')).toBeNull();
        expect(normalizeStorefrontColor('#AbC')).toBe('#aabbcc');
    });

    it('emits the complete CSS variable contract', () => {
        const variables = semanticPaletteCssVariables(resolveStorefrontSemanticPalette('neo-minimalist'));
        expect(variables).toMatchObject({
            '--bg': '#070b14',
            '--paper': '#0e1421',
            '--text': '#f4f7fb',
            '--accent-foreground': '#ffffff',
        });
        expect(Object.values(variables).every(value => /^#[0-9a-f]{6}$/i.test(value))).toBe(true);
    });

    it('keeps resting edges quiet while preserving strong boundaries and keyboard focus', () => {
        const treatments = (['classic', 'neo-minimalist'] as const).map(presetId =>
            resolveStorefrontSkinTreatment(presetId),
        );
        expect(new Set(treatments.map(treatment => treatment.divider)).size).toBe(2);
        for (const presetId of ['classic', 'neo-minimalist'] as const) {
            const palette = resolveStorefrontSemanticPalette(presetId);
            const paletteVariables = semanticPaletteCssVariables(palette);
            const skinVariables = storefrontSkinCssVariables(presetId);
            expect(
                storefrontContrastRatio(paletteVariables['--line-strong'], palette.surface),
            ).toBeGreaterThanOrEqual(3);
            expect(storefrontContrastRatio(paletteVariables['--line'], palette.surface)).toBeLessThan(2);
            expect(
                storefrontContrastRatio(paletteVariables['--focus'], palette.surface),
            ).toBeGreaterThanOrEqual(3);
            expect(paletteVariables['--line']).not.toBe(paletteVariables['--line-strong']);
            expect(skinVariables).toMatchObject({
                '--skin-divider': resolveStorefrontSkinTreatment(presetId).divider,
                '--skin-display-font': resolveStorefrontSkinTreatment(presetId).displayFont,
                '--skin-card-radius': resolveStorefrontSkinTreatment(presetId).cardRadius,
            });
        }
    });

    it('separates classic module outlines from control contrast and resets opt-in decoration in the dark skin', () => {
        const classicPalette = resolveStorefrontSemanticPalette('classic');
        const classic = storefrontSkinCssVariables('classic', classicPalette);
        expect(classic['--skin-card-outline']).toBe('1px solid #dfe3e8');
        expect(storefrontContrastRatio('#dfe3e8', classicPalette.surface)).toBeLessThan(1.5);
        expect(storefrontContrastRatio(classicPalette.border, classicPalette.surface)).toBeGreaterThanOrEqual(
            3,
        );
        expect(classic['--skin-card-outline-shadow']).toBe(classic['--skin-card-shadow']);
        // Explicit initial values trigger each owner's fallback even after a live classic-to-dark switch.
        const dark = storefrontSkinCssVariables('neo-minimalist');
        for (const role of [
            '--skin-card-outline',
            '--skin-card-outline-hover',
            '--skin-card-outline-shadow',
        ]) {
            expect(dark[role]).toBe('initial');
        }
        expect(dark['--skin-card-shadow']).toBe('0 8px 24px rgba(0, 0, 0, 0.24)');
    });

    it('keeps five service colors distinct and readable on every current skin surface', () => {
        for (const presetId of ['classic', 'neo-minimalist'] as const) {
            for (const surfacePreset of ['classic', 'neo-minimalist'] as const) {
                for (const brandColor of ['#ffffff', '#000000', '#777777', '#ffff00']) {
                    const palette = resolveStorefrontSemanticPalette(surfacePreset, {
                        primaryColor: brandColor,
                    });
                    const variables = storefrontSkinCssVariables(presetId, palette);
                    const surfaces = new Set<string>();
                    for (const tone of ['security', 'mail', 'studio', 'coupon', 'support']) {
                        const prefix = `--skin-service-${tone}`;
                        const surface = variables[`${prefix}-surface`];
                        surfaces.add(surface);
                        for (const state of ['surface', 'action', 'action-hover']) {
                            expect(
                                storefrontContrastRatio(
                                    variables[`${prefix}-ink`],
                                    variables[`${prefix}-${state}`],
                                ),
                            ).toBeGreaterThanOrEqual(4.5);
                        }
                        expect(
                            storefrontContrastRatio(variables[`${prefix}-description`], surface),
                        ).toBeGreaterThanOrEqual(4.5);
                    }
                    expect(surfaces.size).toBe(5);
                }
            }
        }
    });

    it('keeps all five service icon tones readable in every skin', () => {
        for (const presetId of ['classic', 'neo-minimalist'] as const) {
            const variables = storefrontSkinCssVariables(presetId);
            for (const tone of ['security', 'mail', 'studio', 'coupon', 'support']) {
                expect(
                    storefrontContrastRatio(
                        variables[`--skin-tool-${tone}-foreground`],
                        variables[`--skin-tool-${tone}-background`],
                    ),
                ).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it.each(['classic', 'neo-minimalist'] as const)(
        'adapts transparent %s icons to the resolved surfaces rather than the preset name',
        presetId => {
            // Cross the two sets of identity hues with light and dark surfaces. This
            // exercises actual adjustment instead of only checking default colors.
            for (const surfacePreset of ['classic', 'neo-minimalist'] as const) {
                for (const brandColor of ['#ffffff', '#000000', '#777777', '#ffff00']) {
                    const palette = resolveStorefrontSemanticPalette(surfacePreset, {
                        primaryColor: brandColor,
                        accentColor: brandColor,
                        highlightColor: brandColor,
                    });
                    const variables = storefrontSkinCssVariables(presetId, palette);
                    const surfaces = [
                        palette.page,
                        palette.surface,
                        palette.elevated,
                        palette.subtle,
                        palette.accentSoft,
                        palette.interactionHover,
                        palette.interactionPressed,
                    ];
                    for (const tone of ['security', 'mail', 'studio', 'coupon', 'support']) {
                        const color = variables[`--skin-tool-${tone}-foreground`];
                        for (const background of surfaces) {
                            expect(storefrontContrastRatio(color, background)).toBeGreaterThanOrEqual(3);
                        }
                    }
                    const defaultSecurity =
                        storefrontSkinCssVariables(presetId)['--skin-tool-security-foreground'];
                    if (
                        surfaces.some(background => storefrontContrastRatio(defaultSecurity, background) < 3)
                    ) {
                        expect(variables['--skin-tool-security-foreground']).not.toBe(defaultSecurity);
                    }
                }
            }
        },
    );
});

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

    it('uses the existing classic blue action color for primary, hover and focus roles', () => {
        const palette = resolveStorefrontSemanticPalette('classic');
        expect(palette.brand).toBe('#2563eb');
        expect(palette.accent).toBe('#2563eb');
        expect(palette.onAccent).toBe('#ffffff');
        expect(palette.accentHover).not.toBe(palette.accent);
        expect(storefrontContrastRatio(palette.onAccent, palette.accentHover)).toBeGreaterThanOrEqual(4.5);
        expect(storefrontContrastRatio(palette.focus, palette.surface)).toBeGreaterThanOrEqual(3);
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
        expect(classic['--skin-card-outline']).toBe('1px solid #d2ddea');
        expect(storefrontContrastRatio('#d2ddea', classicPalette.surface)).toBeLessThan(1.5);
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

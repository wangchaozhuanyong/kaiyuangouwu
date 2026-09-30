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
            expect(auditStorefrontSemanticPalette(resolveStorefrontSemanticPalette(presetId)).passes).toBe(
                true,
            );
        },
    );

    it.each(['#000000', '#ffffff', '#777777', '#8b5cf6', '#070b14'])(
        'keeps classic light and derives safe brand accents from %s',
        color => {
            const palette = resolveStorefrontSemanticPalette('classic', {
                backgroundColor: color,
                primaryColor: color,
                accentColor: color,
                highlightColor: color,
            });
            expect(palette.page).toBe('#f1f5f9');
            expect(palette.surface).toBe('#ffffff');
            expect(palette.text).toBe('#0f172a');
            expect(palette.brand).toBe(color);
            expect(palette.onAccent).toBe('#ffffff');
            expect(storefrontContrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
            expect(storefrontContrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
            expect(storefrontContrastRatio('#ffffff', palette.accentHover)).toBeGreaterThanOrEqual(4.5);
            expect(auditStorefrontSemanticPalette(palette).passes).toBe(true);
        },
    );

    it.each(['#000000', '#ffffff', '#777777', '#070b14'])(
        'separates neutral %s brand identity from the classic action color',
        color => {
            const palette = resolveStorefrontSemanticPalette('classic', {
                primaryColor: color,
                accentColor: color,
                highlightColor: color,
            });
            expect(palette.brand).toBe(color);
            expect(palette.accent).toBe('#2563eb');
            expect(palette.accentHover).not.toBe(color);
            expect(storefrontContrastRatio(palette.accentInk, palette.surface)).toBeGreaterThanOrEqual(4.5);
        },
    );

    it('preserves a chromatic merchant action color', () => {
        const palette = resolveStorefrontSemanticPalette('classic', {
            primaryColor: '#111111',
            accentColor: '#b91c1c',
            highlightColor: '#991b1b',
        });
        expect(palette.brand).toBe('#111111');
        expect(palette.accent).toBe('#b91c1c');
        expect(palette.accentHover).toBe('#991b1b');
    });

    it('uses a saved background only as identity when no primary color exists', () => {
        const palette = resolveStorefrontSemanticPalette('classic', { backgroundColor: '#070b14' });
        expect(palette.brand).toBe('#070b14');
        expect(palette.page).toBe('#f1f5f9');
    });

    it('falls back for empty and invalid brand colors', () => {
        expect(normalizeStorefrontColor('')).toBeNull();
        expect(normalizeStorefrontColor('purple')).toBeNull();
        expect(normalizeStorefrontColor('#AbC')).toBe('#aabbcc');
        expect(resolveStorefrontSemanticPalette('classic', { primaryColor: 'purple' }).brand).toBe('#d33c30');
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

    it('keeps skin surfaces distinct while preserving strong accessible control borders', () => {
        const treatments = (['classic', 'neo-minimalist'] as const).map(presetId =>
            resolveStorefrontSkinTreatment(presetId),
        );
        expect(new Set(treatments.map(treatment => treatment.divider)).size).toBe(2);
        for (const presetId of ['classic', 'neo-minimalist'] as const) {
            const palette = resolveStorefrontSemanticPalette(presetId);
            const paletteVariables = semanticPaletteCssVariables(palette);
            const skinVariables = storefrontSkinCssVariables(presetId);
            expect(
                storefrontContrastRatio(paletteVariables['--line'], palette.surface),
            ).toBeGreaterThanOrEqual(3);
            expect(skinVariables).toMatchObject({
                '--skin-divider': resolveStorefrontSkinTreatment(presetId).divider,
                '--skin-display-font': resolveStorefrontSkinTreatment(presetId).displayFont,
                '--skin-card-radius': resolveStorefrontSkinTreatment(presetId).cardRadius,
            });
        }
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

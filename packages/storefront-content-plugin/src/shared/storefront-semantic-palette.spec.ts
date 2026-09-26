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
    it.each(['classic', 'modern-oriental', 'neo-minimalist'] as const)(
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
        const treatments = (['classic', 'modern-oriental', 'neo-minimalist'] as const).map(presetId =>
            resolveStorefrontSkinTreatment(presetId),
        );
        expect(new Set(treatments.map(treatment => treatment.divider)).size).toBe(3);
        expect(resolveStorefrontSkinTreatment('modern-oriental').displayFont).toContain('PingFang SC');
        for (const presetId of ['classic', 'modern-oriental', 'neo-minimalist'] as const) {
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

    it('keeps all five service icon tones readable in every skin', () => {
        for (const presetId of ['classic', 'modern-oriental', 'neo-minimalist'] as const) {
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
});

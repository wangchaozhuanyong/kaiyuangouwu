import { describe, expect, it } from 'vitest';

import {
    auditStorefrontSemanticPalette,
    normalizeStorefrontColor,
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontContrastRatio,
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
});

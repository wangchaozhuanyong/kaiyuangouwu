import { describe, expect, it } from 'vitest';

import { normalizedHeroThemePreset, normalizedHomepageVisualStyle } from './content-visuals';

describe('store-neutral visual compatibility', () => {
    it('normalizes legacy suffixes without knowing a store or brand name', () => {
        expect(normalizedHomepageVisualStyle('legacy-store-balanced')).toBe('colorful');
        expect(normalizedHomepageVisualStyle('another-store-colorful')).toBe('colorful');
        expect(normalizedHeroThemePreset('legacy-brand-bright')).toBe('bright');
    });

    it('keeps current neutral preset values unchanged', () => {
        expect(normalizedHomepageVisualStyle('standard')).toBe('standard');
        expect(normalizedHomepageVisualStyle('colorful')).toBe('colorful');
        expect(normalizedHeroThemePreset('standard')).toBe('standard');
        expect(normalizedHeroThemePreset('warm')).toBe('warm');
        expect(normalizedHeroThemePreset('bright')).toBe('bright');
    });
});

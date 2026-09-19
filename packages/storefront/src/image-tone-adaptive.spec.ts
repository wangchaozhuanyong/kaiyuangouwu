import { describe, expect, it } from 'vitest';

import { calculateLuminance, heroThemeStyle } from './hero-theme';

describe('Adaptive Image Tone & Typography Contrast Engine', () => {
    it('calculates ITU-R BT.709 perceived luminance correctly', () => {
        // Pure black
        expect(calculateLuminance(0, 0, 0)).toBe(0);
        // Pure white
        expect(calculateLuminance(255, 255, 255)).toBeCloseTo(255, 1);
        // Pure red contributes ~21.26%
        expect(calculateLuminance(255, 0, 0)).toBeCloseTo(54.213, 1);
        // Pure green contributes ~71.52%
        expect(calculateLuminance(0, 255, 0)).toBeCloseTo(182.376, 1);
        // Pure blue contributes ~7.22%
        expect(calculateLuminance(0, 0, 255)).toBeCloseTo(18.411, 1);
    });

    it('automatically assigns dark text (#0f172a / #334155) on light images without manual admin config', () => {
        const style = heroThemeStyle({}, 'light');
        expect(style['--hero-title-color']).toBe('#0f172a');
        expect(style['--hero-body-color']).toBe('#334155');
        // Crisp edge definition shadow (no large blur halo)
        expect(style['--hero-title-shadow']).toContain('rgba(255, 255, 255');
        expect(style['--hero-body-shadow']).toContain('rgba(255, 255, 255');
        expect(style['--hero-body-shadow']).not.toContain('12px');
        // High contrast pagination
        expect(style['--hero-pagination-active-color']).toBe('#0f172a');
    });

    it('automatically assigns white text (#ffffff / #f1f5f9) on dark images without manual admin config', () => {
        const style = heroThemeStyle({}, 'dark');
        expect(style['--hero-title-color']).toBe('#ffffff');
        expect(style['--hero-body-color']).toBe('#f1f5f9');
        expect(style['--hero-title-shadow']).toContain('rgba(0, 0, 0');
        expect(style['--hero-pagination-active-color']).toBe('#ffffff');
    });

    it('keeps secondary text dark when title was manually set to dark color on light image', () => {
        // In the user scenario: title was manually set to navy blue #1d3b58
        const style = heroThemeStyle({ textColor: '#1d3b58' }, 'light');
        expect(style['--hero-title-color']).toBe('#1d3b58');
        // Secondary description must NOT be white! It should adapt to #334155
        expect(style['--hero-body-color']).toBe('#334155');
        expect(style['--hero-body-shadow']).toContain('rgba(255, 255, 255');
    });

    it('uses a strong protective overlay scrim to keep text readable on any background image', () => {
        const lightStyle = heroThemeStyle({}, 'light');
        // Strong protective scrim (0.94) ensures dark text remains readable on any photo
        expect(lightStyle['--hero-overlay-strong']).toBe('rgba(255, 255, 255, 0.94)');
        expect(lightStyle['--hero-overlay-fade']).toBe('transparent');
    });
});

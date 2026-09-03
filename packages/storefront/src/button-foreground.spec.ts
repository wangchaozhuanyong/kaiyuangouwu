import { describe, expect, it } from 'vitest';
import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

describe('global button foreground styles', () => {
    it('does not override Tailwind text color utilities from an unlayered rule', () => {
        const globalButtonRule = stylesheet.match(/^button\s*\{([^}]*)\}/m);

        expect(globalButtonRule).not.toBeNull();
        expect(globalButtonRule?.[1]).not.toMatch(/(?:^|;)\s*color\s*:/);
    });

    it('does not apply red outline or accent color outline to input, textarea, or select in global styles', () => {
        expect(stylesheet).toContain('input:focus-visible');
        expect(stylesheet).toContain('outline: none !important');

        // Must not contain input:focus-visible with red outline
        expect(stylesheet).not.toMatch(/input:focus-visible[^}]*outline:\s*2px\s*solid\s*color-mix/);
        expect(stylesheet).not.toMatch(/textarea:focus-visible[^}]*outline:\s*2px\s*solid\s*color-mix/);
        expect(stylesheet).not.toMatch(/select:focus-visible[^}]*outline:\s*2px\s*solid\s*color-mix/);
    });
});

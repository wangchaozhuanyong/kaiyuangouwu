import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

describe('global button foreground styles', () => {
    it('does not override Tailwind text color utilities from an unlayered rule', () => {
        const globalButtonRule = stylesheet.match(/^button\s*\{([^}]*)\}/m);

        expect(globalButtonRule).not.toBeNull();
        expect(globalButtonRule?.[1]).not.toMatch(/(?:^|;)\s*color\s*:/);
    });

    it('uses a blue replacement focus treatment for text controls without a red outline', () => {
        const boxShadow = 'box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12)';
        const boxShadowIndex = stylesheet.indexOf(boxShadow);
        const focusDeclarations = stylesheet.slice(
            stylesheet.lastIndexOf('{', boxShadowIndex),
            stylesheet.indexOf('}', boxShadowIndex),
        );

        expect(boxShadowIndex).toBeGreaterThan(-1);
        expect(focusDeclarations).toContain('outline: none !important');
        expect(focusDeclarations).toContain(boxShadow);
        expect(focusDeclarations).not.toContain('color-mix');
        expect(focusDeclarations).not.toContain('red');
    });

    it('keeps a visible keyboard outline on native selection controls and buttons', () => {
        expect(stylesheet).toContain(
            ":where(input[type='checkbox'], input[type='radio'], input[type='range']):focus-visible",
        );
        expect(stylesheet).toMatch(/button:focus-visible\s*\{[\s\S]*?outline:\s*2px\s*solid\s*#3b82f6/iu);
        expect(stylesheet).toMatch(
            /input\[type='checkbox'\][^}]*:focus-visible\s*\{[\s\S]*?outline:\s*2px\s*solid\s*#3b82f6/iu,
        );
    });
});

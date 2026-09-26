import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

describe('global button foreground styles', () => {
    it('does not override Tailwind text color utilities from an unlayered rule', () => {
        const globalButtonRule = stylesheet.match(/^button\s*\{([^}]*)\}/m);

        expect(globalButtonRule).not.toBeNull();
        expect(globalButtonRule?.[1]).not.toMatch(/(?:^|;)\s*color\s*:/);
    });

    it('uses a visible semantic focus outline for text controls', () => {
        const focusDeclarations = stylesheet.match(
            /textarea,\s*select\s*\):focus-visible\s*\{([^}]*)\}/,
        )?.[1];

        expect(focusDeclarations).toBeDefined();
        expect(focusDeclarations).toContain('outline: var(--experience-focus-width) solid var(--focus)');
        expect(focusDeclarations).toContain('outline-offset: var(--experience-focus-offset)');
        expect(focusDeclarations).toContain('border-color: var(--focus, #3b82f6)');
        expect(focusDeclarations).not.toContain('outline: none');
    });

    it('keeps a visible keyboard outline on native selection controls and buttons', () => {
        expect(stylesheet).toContain(
            ":where(input[type='checkbox'], input[type='radio'], input[type='range']):focus-visible",
        );
        expect(stylesheet).toMatch(
            /:where\(a\[href\], button, summary, \[role='button'\]\):focus-visible\s*\{[\s\S]*?outline:\s*2px\s*solid\s*var\(--focus,\s*#3b82f6\)/iu,
        );
        expect(stylesheet).toMatch(
            /input\[type='checkbox'\][^}]*:focus-visible\s*\{[\s\S]*?outline:\s*2px\s*solid\s*var\(--focus,\s*#3b82f6\)/iu,
        );
    });
});

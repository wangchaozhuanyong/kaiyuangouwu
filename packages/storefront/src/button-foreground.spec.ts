import { describe, expect, it } from 'vitest';
import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

describe('global button foreground styles', () => {
    it('does not override Tailwind text color utilities from an unlayered rule', () => {
        const globalButtonRule = stylesheet.match(/^button\s*\{([^}]*)\}/m);

        expect(globalButtonRule).not.toBeNull();
        expect(globalButtonRule?.[1]).not.toMatch(/(?:^|;)\s*color\s*:/);
    });
});

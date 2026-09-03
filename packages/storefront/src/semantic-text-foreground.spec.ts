import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();

describe('semantic text foregrounds', () => {
    it('lets contextual text colors override the default strong emphasis', () => {
        const globalStrongRule = stylesheet.match(/^strong,\s*\nb\s*\{([^}]*)\}/m);

        expect(globalStrongRule).not.toBeNull();
        expect(globalStrongRule?.[1]).not.toMatch(/\bcolor\s*:/);
    });
});

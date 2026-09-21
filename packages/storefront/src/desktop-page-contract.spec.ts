import { describe, expect, it } from 'vitest';

import { desktopPageFamilyByRoute } from './desktop-page-contract';
import { storefrontRouteNames } from './storefront-router';

describe('desktop page family contract', () => {
    it('maps every storefront route exactly once into the seven desktop families', () => {
        expect(storefrontRouteNames).toHaveLength(36);
        expect(Object.keys(desktopPageFamilyByRoute).sort()).toEqual([...storefrontRouteNames].sort());
        expect(new Set(Object.values(desktopPageFamilyByRoute))).toEqual(
            new Set(['discovery', 'product', 'commerce', 'account', 'auth', 'tools', 'content']),
        );
    });
});

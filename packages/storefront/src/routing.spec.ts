import { describe, expect, it } from 'vitest';

import { routeFromHash } from './App';

describe('storefront hash routing', () => {
    it('opens the home page for an empty hash', () => {
        expect(routeFromHash('')).toEqual({
            name: 'home',
            id: undefined,
            tab: undefined,
            token: undefined,
            term: undefined,
        });
    });

    it('accepts known paths with optional trailing slashes', () => {
        expect(routeFromHash('#/category/').name).toBe('category');
        expect(routeFromHash('#/product?id=42')).toMatchObject({ name: 'product', id: '42' });
    });

    it('shows the not-found page for an unknown path', () => {
        expect(routeFromHash('#/missing-page').name).toBe('not-found');
    });

    it('keeps valid order tabs and ignores unsupported values', () => {
        expect(routeFromHash('#/orders?tab=shipping').tab).toBe('shipping');
        expect(routeFromHash('#/orders?tab=unknown').tab).toBeUndefined();
    });

    it('opens temporary legal pages from managed footer links', () => {
        expect(routeFromHash('#/legal?id=privacy')).toMatchObject({ name: 'legal', id: 'privacy' });
        expect(routeFromHash('#/legal?id=terms')).toMatchObject({ name: 'legal', id: 'terms' });
    });
});
